import "../load-env";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "./index";
import { usersTable, propertiesTable, propertyPhotosTable } from "./schema";
import { log } from "../log";

/**
 * Idempotent demo-data seeder. Re-running is safe — existing emails are
 * skipped and the seeded property only inserts when the landlord has none
 * yet. Prints a one-line summary either way.
 *
 * Usage: `npm run db:seed`
 */

const PASSWORD = "passw0rd";

const SEED_USERS = [
  {
    email: "admin@naub.local",
    role: "escrow_officer",
    first_name: "Eve",
    last_name: "Officer",
    verification_status: "verified",
  },
  {
    email: "student@naub.local",
    role: "student",
    first_name: "Sani",
    last_name: "Student",
    verification_status: "verified",
    matriculation_number: "NAUB/2024/001",
  },
  {
    email: "landlord@naub.local",
    role: "landlord",
    first_name: "Ladi",
    last_name: "Landlord",
    verification_status: "verified",
  },
] as const;

const SEED_PROPERTY = {
  address: "12 Maiduguri Road, Biu, Borno State",
  rent_amount_ngn: 250_000,
  deposit_amount_ngn: 250_000,
  rooms: 2,
  lease_duration_days: 365,
  amenities: { wifi: true, water: true, security: true, parking: true },
  description:
    "Two-bedroom flat close to campus with reliable water and WiFi. Quiet street, secured compound.",
  house_rules: "No loud music after 10pm. No pets.",
  latitude: 10.611,
  longitude: 12.1909,
};

const PHOTO_URLS = [
  "/listings/listing-1.jpeg",
  "/listings/listing-2.jpeg",
  "/listings/listing-3.jpeg",
  "/listings/listing-4.jpeg",
  "/listings/listing-5.jpeg",
  "/listings/listing-6.jpeg",
  "/listings/listing-7.jpeg",
  "/listings/listing-8.jpeg",
  "/listings/listing-9.jpeg",
];

function generateOccupancyCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

const isUniqueViolation = (err: unknown) =>
  typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";

async function upsertUsers() {
  const password_hash = await bcrypt.hash(PASSWORD, 10);
  let inserted = 0;
  let skipped = 0;

  for (const u of SEED_USERS) {
    const result = await db
      .insert(usersTable)
      .values({
        email: u.email,
        password_hash,
        role: u.role,
        first_name: u.first_name,
        last_name: u.last_name,
        verification_status: u.verification_status,
        matriculation_number: "matriculation_number" in u ? u.matriculation_number : null,
      })
      .onConflictDoNothing({ target: usersTable.email })
      .returning();

    if (result.length > 0) inserted += 1;
    else skipped += 1;
  }

  return { inserted, skipped };
}

async function seedPropertyForLandlord() {
  const [landlord] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, "landlord@naub.local"))
    .limit(1);

  if (!landlord) {
    return { inserted: 0, skipped: 0, reason: "landlord missing" };
  }

  const existing = await db
    .select({ id: propertiesTable.id })
    .from(propertiesTable)
    .where(eq(propertiesTable.landlord_id, landlord.id))
    .limit(1);

  if (existing.length > 0) {
    return { inserted: 0, skipped: 1, reason: "landlord already has a property" };
  }

  // Retry on the very-unlikely event of an occupancy-code collision.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const [property] = await db
        .insert(propertiesTable)
        .values({
          landlord_id: landlord.id,
          address: SEED_PROPERTY.address,
          rent_amount_ngn: SEED_PROPERTY.rent_amount_ngn,
          deposit_amount_ngn: SEED_PROPERTY.deposit_amount_ngn,
          rooms: SEED_PROPERTY.rooms,
          lease_duration_days: SEED_PROPERTY.lease_duration_days,
          amenities: SEED_PROPERTY.amenities,
          description: SEED_PROPERTY.description,
          house_rules: SEED_PROPERTY.house_rules,
          latitude: SEED_PROPERTY.latitude,
          longitude: SEED_PROPERTY.longitude,
          occupancy_code: generateOccupancyCode(),
          listing_status: "live",
          published_at: new Date(),
        })
        .returning();

      if (!property) throw new Error("insert returned no row");

      await db.insert(propertyPhotosTable).values(
        PHOTO_URLS.map((photo_url, photo_order) => ({ property_id: property.id, photo_url, photo_order })),
      );

      return { inserted: 1, skipped: 0 };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      lastErr = err;
    }
  }
  throw lastErr ?? new Error("could not allocate occupancy code");
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to run db:seed");
  }

  const users = await upsertUsers();
  const property = await seedPropertyForLandlord();

  const summary = {
    users: users,
    property,
    credentials: SEED_USERS.map((u) => ({ email: u.email, role: u.role, password: PASSWORD })),
  };
  log.info("db:seed complete", summary as unknown as Record<string, unknown>);

  // Also print to stdout in a human-readable form (the structured log goes
  // to stdout anyway, but the format is parseable JSON in prod).
  console.log("\nseed summary:");
  console.log(`  users:    ${users.inserted} inserted, ${users.skipped} skipped`);
  if ("reason" in property) {
    console.log(`  property: skipped (${property.reason})`);
  } else {
    console.log(`  property: ${property.inserted} inserted, ${property.skipped} skipped`);
  }
  console.log("\ncredentials (password is the same for all three):");
  for (const c of summary.credentials) {
    console.log(`  ${c.role.padEnd(15)} ${c.email}  /  ${c.password}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    log.error("db:seed failed", { err });
    process.exit(1);
  });
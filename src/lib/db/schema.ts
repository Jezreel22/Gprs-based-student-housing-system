import { pgTable, text, integer, boolean, timestamp, uuid, jsonb, real, date, check, customType, index, unique, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Drizzle 0.45 has no first-class `bytea` column, so we declare one. The
// column stores raw image bytes; postgres-js encodes/decodes Buffers for
// bytea automatically. Used by /api/upload to persist uploads in the DB —
// the serverless filesystem on Vercel is read-only, so we can't write to
// `public/uploads/` at runtime the way a long-lived server would.
export const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return "bytea";
  },
});

// ─── users ─────────────────────────────────────────────────────────────────
export const usersTable = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").unique().notNull(),
  password_hash: text("password_hash"),
  google_id: text("google_id").unique(),
  role: text("role").notNull(),

  first_name: text("first_name"),
  last_name: text("last_name"),
  phone_number: text("phone_number"),
  profile_photo_url: text("profile_photo_url"),

  matriculation_number: text("matriculation_number").unique(),
  naub_verified_at: timestamp("naub_verified_at"),

  national_id_type: text("national_id_type"),
  national_id_document_url: text("national_id_document_url"),
  national_id_verified_at: timestamp("national_id_verified_at"),
  selfie_url: text("selfie_url"),
  selfie_verified_at: timestamp("selfie_verified_at"),
  property_document_url: text("property_document_url"),
  kyc_submitted_at: timestamp("kyc_submitted_at"),

  letter_of_agency_url: text("letter_of_agency_url"),
  letter_of_agency_verified_at: timestamp("letter_of_agency_verified_at"),
  sponsoring_landlord_id: uuid("sponsoring_landlord_id"),

  verification_status: text("verification_status").default("pending"),
  email_verified_at: timestamp("email_verified_at"),
  phone_verified_at: timestamp("phone_verified_at"),
  profile_completed_at: timestamp("profile_completed_at"),
  cancellation_count: integer("cancellation_count").default(0),
  account_suspended: boolean("account_suspended").default(false),
  suspension_reason: text("suspension_reason"),

  // ─── payout details (landlords/agents only) ─────────────────────────────
  // We store the Paystack `recipient_code` so we can initiate transfers
  // without re-collecting account details on every payout. The bank account
  // number is stored plain-text for now; production-grade encryption is a
  // follow-up (out of scope for this pass).
  payout_bank_code: text("payout_bank_code"),
  payout_account_number: text("payout_account_number"),
  payout_account_name: text("payout_account_name"),
  paystack_recipient_code: text("paystack_recipient_code"),
  payout_details_set_at: timestamp("payout_details_set_at"),

  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
});

// ─── properties ────────────────────────────────────────────────────────────
export const propertiesTable = pgTable("properties", {
  id: uuid("id").primaryKey().defaultRandom(),
  landlord_id: uuid("landlord_id").notNull().references(() => usersTable.id),

  address: text("address").notNull(),
  latitude: real("latitude"),
  longitude: real("longitude"),

  rent_amount_ngn: integer("rent_amount_ngn").notNull(),
  deposit_amount_ngn: integer("deposit_amount_ngn").notNull(),
  lease_duration_days: integer("lease_duration_days"),

  rooms: integer("rooms").default(1),
  amenities: jsonb("amenities").$type<Record<string, boolean>>(),
  house_rules: text("house_rules"),
  description: text("description"),

  occupancy_code: text("occupancy_code").notNull().unique(),

  geolocation_verified_at: timestamp("geolocation_verified_at"),
  listing_status: text("listing_status").default("draft"),
  published_at: timestamp("published_at"),

  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
});

// ─── property_photos ───────────────────────────────────────────────────────
export const propertyPhotosTable = pgTable("property_photos", {
  id: uuid("id").primaryKey().defaultRandom(),
  property_id: uuid("property_id").notNull().references(() => propertiesTable.id, { onDelete: "cascade" }),

  photo_url: text("photo_url").notNull(),
  photo_order: integer("photo_order").default(0),
  exif_metadata: jsonb("exif_metadata"),
  flagged_as_stock: boolean("flagged_as_stock").default(false),
  flagged_reason: text("flagged_reason"),

  uploaded_at: timestamp("uploaded_at").defaultNow(),
});

// Property favorites — a student's "saved" listings. Composite unique on
// (user_id, property_id) prevents double-favoriting. Cascade-delete so
// removing a user or property also drops their favorites (no orphans).
export const propertyFavoritesTable = pgTable(
  "property_favorites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    property_id: uuid("property_id").notNull().references(() => propertiesTable.id, { onDelete: "cascade" }),
    created_at: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    uniqUserProperty: uniqueIndex("uniq_user_property_favorite").on(t.user_id, t.property_id),
    byUser: index("idx_property_favorites_user").on(t.user_id),
    byProperty: index("idx_property_favorites_property").on(t.property_id),
  }),
);

// ─── uploads ───────────────────────────────────────────────────────────────
// Binary blobs for files posted to /api/upload (currently property photos).
// Bytes live in `data` as bytea; the matching GET route at /api/uploads/<id>
// streams them back with the stored MIME type.
export const uploadsTable = pgTable("uploads", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  mime: text("mime").notNull(),
  size_bytes: integer("size_bytes").notNull(),
  data: bytea("data").notNull(),
  created_at: timestamp("created_at").defaultNow(),
});

// ─── bookings ──────────────────────────────────────────────────────────────
export const bookingsTable = pgTable("bookings", {
  id: uuid("id").primaryKey().defaultRandom(),
  student_id: uuid("student_id").notNull().references(() => usersTable.id),
  property_id: uuid("property_id").notNull().references(() => propertiesTable.id),
  landlord_id: uuid("landlord_id").notNull().references(() => usersTable.id),

  lease_start_date: date("lease_start_date"),
  lease_duration_days: integer("lease_duration_days"),
  lease_end_date: date("lease_end_date"),

  rent_amount_ngn: integer("rent_amount_ngn").notNull(),
  deposit_amount_ngn: integer("deposit_amount_ngn").notNull(),
  total_amount_ngn: integer("total_amount_ngn").notNull(),

  escrow_account_reference: text("escrow_account_reference"),
  payment_method: text("payment_method"),
  payment_transaction_id: text("payment_transaction_id"),
  funds_received_at: timestamp("funds_received_at"),

  occupancy_verified_at: timestamp("occupancy_verified_at"),
  occupancy_confirmed_by_student_at: timestamp("occupancy_confirmed_by_student_at"),
  occupancy_gps_latitude: real("occupancy_gps_latitude"),
  occupancy_gps_longitude: real("occupancy_gps_longitude"),
  occupancy_code_entered: text("occupancy_code_entered"),
  occupancy_verification_photo_url: text("occupancy_verification_photo_url"),
  occupancy_attempts: integer("occupancy_attempts").default(0),

  escrow_released_at: timestamp("escrow_released_at"),
  escrow_release_reason: text("escrow_release_reason"),

  dispute_filed_at: timestamp("dispute_filed_at"),
  dispute_status: text("dispute_status").default("no_dispute"),
  dispute_adjudication_date: timestamp("dispute_adjudication_date"),
  dispute_outcome: text("dispute_outcome"),

  booking_status: text("booking_status").default("pending_payment"),

  // ─── payout / release tracking ────────────────────────────────────────
  // Set when the app initiates a Paystack transfer to the landlord's bank
  // account. `payout_transfer_reference` is the Paystack `transfer_code` we
  // correlate the `transfer.success` / `transfer.failed` webhook events to.
  payout_transfer_reference: text("payout_transfer_reference"),
  payout_initiated_at: timestamp("payout_initiated_at"),
  payout_attempts: integer("payout_attempts").default(0),
  payout_error: text("payout_error"),
  // Non-null means an escrow officer placed this booking on hold — the lazy
  // auto-release helper skips it. Officer can release early via the override.
  release_held_by_officer_at: timestamp("release_held_by_officer_at"),
  // Non-null means an escrow officer flagged the payment as under manual
  // verification (e.g. a bank_transfer booking with no gateway receipt).
  // Bookings cleared by a Paystack webhook skip this stage — see the admin
  // escrow ledger for which bookings require officer verification.
  under_verification_by_officer_at: timestamp("under_verification_by_officer_at"),

  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
});

// ─── booking admin notes ───────────────────────────────────────────────────
// Append-only internal notes an escrow officer attaches to a booking. There is
// no UPDATE/DELETE path in code — the table is immutable by convention (and a
// DB role can revoke write-update as a follow-up). Pairs with the audit trail.
export const bookingAdminNotesTable = pgTable("booking_admin_notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  booking_id: uuid("booking_id").notNull().references(() => bookingsTable.id, { onDelete: "cascade" }),
  officer_id: uuid("officer_id").references(() => usersTable.id, { onDelete: "set null" }),
  note: text("note").notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("booking_admin_notes_booking_created_idx").on(table.booking_id, table.created_at),
]);

// ─── disputes ──────────────────────────────────────────────────────────────
export const disputesTable = pgTable("disputes", {
  id: uuid("id").primaryKey().defaultRandom(),
  booking_id: uuid("booking_id").notNull().references(() => bookingsTable.id),
  student_id: uuid("student_id").notNull().references(() => usersTable.id),
  landlord_id: uuid("landlord_id").notNull().references(() => usersTable.id),

  reason: text("reason").notNull(),
  description: text("description").notNull(),

  student_evidence: jsonb("student_evidence"),
  landlord_response: text("landlord_response"),
  landlord_response_evidence: jsonb("landlord_response_evidence"),

  escrow_officer_id: uuid("escrow_officer_id").references(() => usersTable.id),
  adjudication_notes: text("adjudication_notes"),
  adjudication_decision: text("adjudication_decision"),
  refund_percentage_to_student: integer("refund_percentage_to_student"),

  dispute_status: text("dispute_status").default("open"),

  created_at: timestamp("created_at").defaultNow(),
  resolved_at: timestamp("resolved_at"),
});

// ─── messages ──────────────────────────────────────────────────────────────
export const messagesTable = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  sender_id: uuid("sender_id").notNull().references(() => usersTable.id),
  recipient_id: uuid("recipient_id").notNull().references(() => usersTable.id),
  booking_id: uuid("booking_id").references(() => bookingsTable.id),

  message_text: text("message_text").notNull(),
  message_type: text("message_type").default("text"),
  attachment_url: text("attachment_url"),

  read_at: timestamp("read_at"),
  created_at: timestamp("created_at").defaultNow(),
});

// ─── ratings ───────────────────────────────────────────────────────────────
export const ratingsTable = pgTable("ratings", {
  id: uuid("id").primaryKey().defaultRandom(),
  booking_id: uuid("booking_id").notNull().references(() => bookingsTable.id, { onDelete: "cascade" }),
  rater_id: uuid("rater_id").notNull().references(() => usersTable.id),
  ratee_id: uuid("ratee_id").notNull().references(() => usersTable.id),

  rating_type: text("rating_type").notNull(),
  stars: integer("stars").notNull(),
  review_text: text("review_text"),

  created_at: timestamp("created_at").defaultNow(),
}, (table) => [
  // Restrict rating_type to the single supported direction; guards against
  // legacy rows or bugs that insert the removed landlord→student variant.
  check("ratings_rating_type_check",
    sql`${table.rating_type} = 'student_rates_landlord'`
  ),
]);

// ─── property_ratings ──────────────────────────────────────────────────────
// A student's rating of a *property/listing* — separate from the user-centric
// `ratings` table (which rates landlords). One row per student per booking:
// `booking_id` ties it to a real completed stay, and the (booking_id, rater_id)
// unique constraint dedupes the two submission paths (listing page + booking
// review flow). `property_id` is denormalized from booking.property_id for cheap
// listing-page queries.
export const propertyRatingsTable = pgTable("property_ratings", {
  id: uuid("id").primaryKey().defaultRandom(),
  property_id: uuid("property_id").notNull().references(() => propertiesTable.id, { onDelete: "cascade" }),
  booking_id: uuid("booking_id").notNull().references(() => bookingsTable.id, { onDelete: "cascade" }),
  rater_id: uuid("rater_id").notNull().references(() => usersTable.id),
  stars: integer("stars").notNull(),
  review_text: text("review_text"),
  created_at: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  unique("property_ratings_booking_rater_unq").on(table.booking_id, table.rater_id),
  index("property_ratings_property_idx").on(table.property_id),
]);

// ─── trust_scores ──────────────────────────────────────────────────────────
export const trustScoresTable = pgTable("trust_scores", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull().unique().references(() => usersTable.id, { onDelete: "cascade" }),

  total_score: integer("total_score").default(50),
  trust_level: text("trust_level").default("average"),

  identity_verification_points: integer("identity_verification_points").default(0),
  property_verification_points: integer("property_verification_points").default(0),
  transaction_completion_points: integer("transaction_completion_points").default(0),
  ratings_average_points: integer("ratings_average_points").default(0),
  fraud_report_deduction: integer("fraud_report_deduction").default(0),
  tenure_bonus_points: integer("tenure_bonus_points").default(0),

  total_transactions: integer("total_transactions").default(0),
  completed_transactions: integer("completed_transactions").default(0),
  average_rating: real("average_rating").default(0),
  fraud_reports_count: integer("fraud_reports_count").default(0),

  last_recomputed_at: timestamp("last_recomputed_at").defaultNow(),
});

// ─── trust events ──────────────────────────────────────────────────────────
// Immutable scoring ledger. `trust_scores` is a fast projection of these rows;
// the ledger remains the source of truth and makes replay/backfill safe.
//
// `expires_at` lets negative fraud/dispute/property events age out so users
// aren't permanently punished by a single isolated mistake. NULL = event
// never expires (positive events and rules we choose to keep indefinitely).
// The recompute folds `active=true AND (expires_at IS NULL OR expires_at>now())`
// into the projection; the history endpoint still surfaces expired rows with
// `expired: true` so the audit trail stays complete.
export const trustEventsTable = pgTable("trust_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  rule_key: text("rule_key").notNull(),
  points_delta: integer("points_delta").notNull(),
  source_type: text("source_type").notNull(),
  source_id: text("source_id"),
  dedupe_key: text("dedupe_key").notNull().unique(),
  actor_id: uuid("actor_id").references(() => usersTable.id, { onDelete: "set null" }),
  reason: text("reason").notNull(),
  details: jsonb("details").$type<Record<string, unknown>>(),
  active: boolean("active").default(true).notNull(),
  expires_at: timestamp("expires_at"),
  created_at: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("trust_events_user_created_idx").on(table.user_id, table.created_at),
  index("trust_events_rule_created_idx").on(table.rule_key, table.created_at),
  index("trust_events_source_idx").on(table.source_type, table.source_id),
  index("trust_events_expires_idx").on(table.expires_at),
]);

// ─── trust reports ─────────────────────────────────────────────────────────
// Reports are not trust penalties until an escrow officer substantiates them.
export const trustReportsTable = pgTable("trust_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  reporter_id: uuid("reporter_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  target_user_id: uuid("target_user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  target_property_id: uuid("target_property_id").references(() => propertiesTable.id, { onDelete: "cascade" }),
  report_type: text("report_type").notNull(),
  description: text("description").notNull(),
  status: text("status").default("open").notNull(),
  officer_id: uuid("officer_id").references(() => usersTable.id, { onDelete: "set null" }),
  officer_notes: text("officer_notes"),
  resolved_at: timestamp("resolved_at"),
  created_at: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("trust_reports_target_user_status_idx").on(table.target_user_id, table.status),
  index("trust_reports_target_property_status_idx").on(table.target_property_id, table.status),
  index("trust_reports_status_created_idx").on(table.status, table.created_at),
]);

// ─── verification challenges ───────────────────────────────────────────────
// Provider-neutral, single-use challenge records. Token/OTP plaintext is never
// stored; service code hashes it before insertion.
export const verificationChallengesTable = pgTable("verification_challenges", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  channel: text("channel").notNull(),
  destination: text("destination").notNull(),
  token_hash: text("token_hash").notNull(),
  expires_at: timestamp("expires_at").notNull(),
  consumed_at: timestamp("consumed_at"),
  attempt_count: integer("attempt_count").default(0).notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("verification_challenges_user_channel_created_idx").on(table.user_id, table.channel, table.created_at),
  index("verification_challenges_destination_expires_idx").on(table.destination, table.expires_at),
]);

// ─── audit_log ─────────────────────────────────────────────────────────────
export const auditLogTable = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  actor_id: uuid("actor_id").notNull().references(() => usersTable.id),
  action_type: text("action_type").notNull(),
  resource_type: text("resource_type"),
  resource_id: uuid("resource_id"),
  details: jsonb("details"),
  ip_address: text("ip_address"),
  user_agent: text("user_agent"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

// ─── notifications ────────────────────────────────────────────────────────
// Lightweight in-app notification stream. Drives the bell icon in the NavBar.
// Polled every 30s when the user is signed in. Triggers live in route
// handlers (post-message, escrow release, etc.). `related_id` is a free-form
// pointer to the originating entity (message id, booking id, etc.) so the
// UI can deep-link the notification.
export const notificationsTable = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(),        // "message" | "escrow_release" | "escrow_failed" | "login" | "system"
  title: text("title").notNull(),
  body: text("body"),
  related_id: text("related_id"),
  related_type: text("related_type"),  // "message" | "booking" | etc.
  read_at: timestamp("read_at"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

// Inferred types — re-exported for use throughout the route handlers
export type User = typeof usersTable.$inferSelect;
export type NewUser = typeof usersTable.$inferInsert;
export type Property = typeof propertiesTable.$inferSelect;
export type NewProperty = typeof propertiesTable.$inferInsert;
export type PropertyPhoto = typeof propertyPhotosTable.$inferSelect;
export type NewPropertyPhoto = typeof propertyPhotosTable.$inferInsert;
export type PropertyFavorite = typeof propertyFavoritesTable.$inferSelect;
export type NewPropertyFavorite = typeof propertyFavoritesTable.$inferInsert;
export type Upload = typeof uploadsTable.$inferSelect;
export type NewUpload = typeof uploadsTable.$inferInsert;
export type Booking = typeof bookingsTable.$inferSelect;
export type NewBooking = typeof bookingsTable.$inferInsert;
export type BookingAdminNote = typeof bookingAdminNotesTable.$inferSelect;
export type NewBookingAdminNote = typeof bookingAdminNotesTable.$inferInsert;
export type Dispute = typeof disputesTable.$inferSelect;
export type NewDispute = typeof disputesTable.$inferInsert;
export type Message = typeof messagesTable.$inferSelect;
export type NewMessage = typeof messagesTable.$inferInsert;
export type Rating = typeof ratingsTable.$inferSelect;
export type NewRating = typeof ratingsTable.$inferInsert;
export type PropertyRating = typeof propertyRatingsTable.$inferSelect;
export type NewPropertyRating = typeof propertyRatingsTable.$inferInsert;
export type TrustScore = typeof trustScoresTable.$inferSelect;
export type NewTrustScore = typeof trustScoresTable.$inferInsert;
export type TrustEvent = typeof trustEventsTable.$inferSelect;
export type NewTrustEvent = typeof trustEventsTable.$inferInsert;
export type TrustReport = typeof trustReportsTable.$inferSelect;
export type NewTrustReport = typeof trustReportsTable.$inferInsert;
export type VerificationChallenge = typeof verificationChallengesTable.$inferSelect;
export type NewVerificationChallenge = typeof verificationChallengesTable.$inferInsert;
export type AuditLog = typeof auditLogTable.$inferSelect;
export type NewAuditLog = typeof auditLogTable.$inferInsert;
export type Notification = typeof notificationsTable.$inferSelect;
export type NewNotification = typeof notificationsTable.$inferInsert;

export const schema = {
  usersTable,
  propertiesTable,
  propertyPhotosTable,
  propertyFavoritesTable,
  uploadsTable,
  bookingsTable,
  disputesTable,
  messagesTable,
  ratingsTable,
  propertyRatingsTable,
  trustScoresTable,
  trustEventsTable,
  trustReportsTable,
  verificationChallengesTable,
  auditLogTable,
  notificationsTable,
};
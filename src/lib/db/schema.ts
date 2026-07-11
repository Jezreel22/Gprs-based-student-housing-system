import { pgTable, text, integer, boolean, timestamp, uuid, jsonb, real, date, check, customType } from "drizzle-orm/pg-core";
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
  account_suspended: boolean("account_suspended").default(false),
  suspension_reason: text("suspension_reason"),

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

  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
});

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
});

// ─── trust_scores ──────────────────────────────────────────────────────────
export const trustScoresTable = pgTable("trust_scores", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull().unique().references(() => usersTable.id, { onDelete: "cascade" }),

  total_score: integer("total_score").default(0),

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

// Inferred types — re-exported for use throughout the route handlers
export type User = typeof usersTable.$inferSelect;
export type NewUser = typeof usersTable.$inferInsert;
export type Property = typeof propertiesTable.$inferSelect;
export type NewProperty = typeof propertiesTable.$inferInsert;
export type PropertyPhoto = typeof propertyPhotosTable.$inferSelect;
export type NewPropertyPhoto = typeof propertyPhotosTable.$inferInsert;
export type Upload = typeof uploadsTable.$inferSelect;
export type NewUpload = typeof uploadsTable.$inferInsert;
export type Booking = typeof bookingsTable.$inferSelect;
export type NewBooking = typeof bookingsTable.$inferInsert;
export type Dispute = typeof disputesTable.$inferSelect;
export type NewDispute = typeof disputesTable.$inferInsert;
export type Message = typeof messagesTable.$inferSelect;
export type NewMessage = typeof messagesTable.$inferInsert;
export type Rating = typeof ratingsTable.$inferSelect;
export type NewRating = typeof ratingsTable.$inferInsert;
export type TrustScore = typeof trustScoresTable.$inferSelect;
export type NewTrustScore = typeof trustScoresTable.$inferInsert;
export type AuditLog = typeof auditLogTable.$inferSelect;
export type NewAuditLog = typeof auditLogTable.$inferInsert;

export const schema = {
  usersTable,
  propertiesTable,
  propertyPhotosTable,
  uploadsTable,
  bookingsTable,
  disputesTable,
  messagesTable,
  ratingsTable,
  trustScoresTable,
  auditLogTable,
};
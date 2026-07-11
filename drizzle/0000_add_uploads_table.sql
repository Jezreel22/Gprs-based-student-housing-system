CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid NOT NULL,
	"action_type" text NOT NULL,
	"resource_type" text,
	"resource_id" uuid,
	"details" jsonb,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"landlord_id" uuid NOT NULL,
	"lease_start_date" date,
	"lease_duration_days" integer,
	"lease_end_date" date,
	"rent_amount_ngn" integer NOT NULL,
	"deposit_amount_ngn" integer NOT NULL,
	"total_amount_ngn" integer NOT NULL,
	"escrow_account_reference" text,
	"payment_method" text,
	"payment_transaction_id" text,
	"funds_received_at" timestamp,
	"occupancy_verified_at" timestamp,
	"occupancy_confirmed_by_student_at" timestamp,
	"occupancy_gps_latitude" real,
	"occupancy_gps_longitude" real,
	"occupancy_code_entered" text,
	"occupancy_verification_photo_url" text,
	"occupancy_attempts" integer DEFAULT 0,
	"escrow_released_at" timestamp,
	"escrow_release_reason" text,
	"dispute_filed_at" timestamp,
	"dispute_status" text DEFAULT 'no_dispute',
	"dispute_adjudication_date" timestamp,
	"dispute_outcome" text,
	"booking_status" text DEFAULT 'pending_payment',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"landlord_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"description" text NOT NULL,
	"student_evidence" jsonb,
	"landlord_response" text,
	"landlord_response_evidence" jsonb,
	"escrow_officer_id" uuid,
	"adjudication_notes" text,
	"adjudication_decision" text,
	"refund_percentage_to_student" integer,
	"dispute_status" text DEFAULT 'open',
	"created_at" timestamp DEFAULT now(),
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sender_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"booking_id" uuid,
	"message_text" text NOT NULL,
	"message_type" text DEFAULT 'text',
	"attachment_url" text,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"landlord_id" uuid NOT NULL,
	"address" text NOT NULL,
	"latitude" real,
	"longitude" real,
	"rent_amount_ngn" integer NOT NULL,
	"deposit_amount_ngn" integer NOT NULL,
	"lease_duration_days" integer,
	"rooms" integer DEFAULT 1,
	"amenities" jsonb,
	"house_rules" text,
	"description" text,
	"occupancy_code" text NOT NULL,
	"geolocation_verified_at" timestamp,
	"listing_status" text DEFAULT 'draft',
	"published_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "properties_occupancy_code_unique" UNIQUE("occupancy_code")
);
--> statement-breakpoint
CREATE TABLE "property_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"photo_url" text NOT NULL,
	"photo_order" integer DEFAULT 0,
	"exif_metadata" jsonb,
	"flagged_as_stock" boolean DEFAULT false,
	"flagged_reason" text,
	"uploaded_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"rater_id" uuid NOT NULL,
	"ratee_id" uuid NOT NULL,
	"rating_type" text NOT NULL,
	"stars" integer NOT NULL,
	"review_text" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "trust_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"total_score" integer DEFAULT 0,
	"identity_verification_points" integer DEFAULT 0,
	"property_verification_points" integer DEFAULT 0,
	"transaction_completion_points" integer DEFAULT 0,
	"ratings_average_points" integer DEFAULT 0,
	"fraud_report_deduction" integer DEFAULT 0,
	"tenure_bonus_points" integer DEFAULT 0,
	"total_transactions" integer DEFAULT 0,
	"completed_transactions" integer DEFAULT 0,
	"average_rating" real DEFAULT 0,
	"fraud_reports_count" integer DEFAULT 0,
	"last_recomputed_at" timestamp DEFAULT now(),
	CONSTRAINT "trust_scores_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"google_id" text,
	"role" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"phone_number" text,
	"profile_photo_url" text,
	"matriculation_number" text,
	"naub_verified_at" timestamp,
	"national_id_type" text,
	"national_id_document_url" text,
	"national_id_verified_at" timestamp,
	"selfie_url" text,
	"selfie_verified_at" timestamp,
	"property_document_url" text,
	"kyc_submitted_at" timestamp,
	"letter_of_agency_url" text,
	"letter_of_agency_verified_at" timestamp,
	"sponsoring_landlord_id" uuid,
	"verification_status" text DEFAULT 'pending',
	"account_suspended" boolean DEFAULT false,
	"suspension_reason" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_google_id_unique" UNIQUE("google_id"),
	CONSTRAINT "users_matriculation_number_unique" UNIQUE("matriculation_number")
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_landlord_id_users_id_fk" FOREIGN KEY ("landlord_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_landlord_id_users_id_fk" FOREIGN KEY ("landlord_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_escrow_officer_id_users_id_fk" FOREIGN KEY ("escrow_officer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_landlord_id_users_id_fk" FOREIGN KEY ("landlord_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_photos" ADD CONSTRAINT "property_photos_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_rater_id_users_id_fk" FOREIGN KEY ("rater_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_ratee_id_users_id_fk" FOREIGN KEY ("ratee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_scores" ADD CONSTRAINT "trust_scores_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
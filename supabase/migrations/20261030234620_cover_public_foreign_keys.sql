-- NYEOCARE public foreign-key covering indexes.
-- Catalog audit 2026-10-31: 167 public foreign keys; 73 lacked an existing
-- valid, non-partial B-tree index with the FK columns as its leading key prefix.
--
-- Production rollout built these indexes with CREATE INDEX CONCURRENTLY,
-- one index at a time per table, so reads/writes were not blocked for the build.
-- They are already present and valid in production. IF NOT EXISTS makes this
-- migration a no-op for those existing production indexes, while preserving the
-- complete desired schema for fresh environments. Do not drop/rebuild these
-- indexes merely to re-run the migration.

CREATE INDEX IF NOT EXISTS ixfk_aria_actions_4b98157d ON public.aria_actions USING btree (organization_id, observation_id);

CREATE INDEX IF NOT EXISTS ixfk_aria_actions_6ab12af0 ON public.aria_actions USING btree (organization_id, approved_by);

CREATE INDEX IF NOT EXISTS ixfk_aria_actions_a4fe3cbf ON public.aria_actions USING btree (approved_by);

CREATE INDEX IF NOT EXISTS ixfk_aria_actions_bfef9a62 ON public.aria_actions USING btree (observation_id);

CREATE INDEX IF NOT EXISTS ixfk_aria_actions_d22cfc77 ON public.aria_actions USING btree (person_id);

CREATE INDEX IF NOT EXISTS ixfk_aria_activity_log_7b33400f ON public.aria_activity_log USING btree (actor_id);

CREATE INDEX IF NOT EXISTS ixfk_aria_attendance_contexts_427d2dca ON public.aria_attendance_contexts USING btree (resolved_by);

CREATE INDEX IF NOT EXISTS ixfk_aria_attendance_contexts_8a5f496e ON public.aria_attendance_contexts USING btree (session_id);

CREATE INDEX IF NOT EXISTS ixfk_aria_attendance_contexts_9ef1cf6f ON public.aria_attendance_contexts USING btree (person_id);

CREATE INDEX IF NOT EXISTS ixfk_aria_attendance_contexts_b44790ae ON public.aria_attendance_contexts USING btree (created_by);

CREATE INDEX IF NOT EXISTS ixfk_aria_brain_feed_2d84c427 ON public.aria_brain_feed USING btree (person_id);

CREATE INDEX IF NOT EXISTS ixfk_aria_care_contexts_05128303 ON public.aria_care_contexts USING btree (person_id);

CREATE INDEX IF NOT EXISTS ixfk_aria_conversations_3be82c51 ON public.aria_conversations USING btree (user_id);

CREATE INDEX IF NOT EXISTS ixfk_aria_conversations_9875dc1b ON public.aria_conversations USING btree (person_id);

CREATE INDEX IF NOT EXISTS ixfk_aria_events_82a4eb29 ON public.aria_events USING btree (actor_id);

CREATE INDEX IF NOT EXISTS ixfk_aria_events_b8c0e376 ON public.aria_events USING btree (organization_id, actor_id);

CREATE INDEX IF NOT EXISTS ixfk_aria_internal_messages_e30a692f ON public.aria_internal_messages USING btree (unsent_by);

CREATE INDEX IF NOT EXISTS ixfk_aria_learning_44758233 ON public.aria_learning USING btree (person_id);

CREATE INDEX IF NOT EXISTS ixfk_aria_person_state_ea59d89d ON public.aria_person_state USING btree (person_id);

CREATE INDEX IF NOT EXISTS ixfk_attendance_records_202aa331 ON public.attendance_records USING btree (organization_id, marked_by);

CREATE INDEX IF NOT EXISTS ixfk_attendance_records_27c3b90a ON public.attendance_records USING btree (session_section_id);

CREATE INDEX IF NOT EXISTS ixfk_attendance_records_478695be ON public.attendance_records USING btree (marked_by);

CREATE INDEX IF NOT EXISTS ixfk_attendance_records_6b50832f ON public.attendance_records USING btree (reviewed_by);

CREATE INDEX IF NOT EXISTS ixfk_attendance_records_dd1f5df8 ON public.attendance_records USING btree (organization_id, source_sheet_id);

CREATE INDEX IF NOT EXISTS ixfk_attendance_records_e1c73459 ON public.attendance_records USING btree (source_sheet_id);

CREATE INDEX IF NOT EXISTS ixfk_attendance_records_e57cb3ac ON public.attendance_records USING btree (organization_id, reviewed_by);

CREATE INDEX IF NOT EXISTS ixfk_attendance_records_eef3d1d0 ON public.attendance_records USING btree (organization_id, session_section_id);

CREATE INDEX IF NOT EXISTS ixfk_attendance_sheets_5edcf542 ON public.attendance_sheets USING btree (uploaded_by);

CREATE INDEX IF NOT EXISTS ixfk_attendance_sheets_9d8c831d ON public.attendance_sheets USING btree (organization_id, uploaded_by);

CREATE INDEX IF NOT EXISTS ixfk_care_feedback_8a741bcf ON public.care_feedback USING btree (actor_id);

CREATE INDEX IF NOT EXISTS ixfk_care_feedback_cb3df074 ON public.care_feedback USING btree (action_id);

CREATE INDEX IF NOT EXISTS ixfk_daily_briefings_944a2791 ON public.daily_briefings USING btree (organization_id);

CREATE INDEX IF NOT EXISTS ixfk_identity_pair_decisions_29dce9da ON public.identity_pair_decisions USING btree (decided_by);

CREATE INDEX IF NOT EXISTS ixfk_identity_pair_decisions_44eb23ca ON public.identity_pair_decisions USING btree (person_b_id);

CREATE INDEX IF NOT EXISTS ixfk_identity_pair_decisions_7d2ecee7 ON public.identity_pair_decisions USING btree (person_a_id);

CREATE INDEX IF NOT EXISTS ixfk_identity_shared_contacts_bf4fad0e ON public.identity_shared_contacts USING btree (person_b_id);

CREATE INDEX IF NOT EXISTS ixfk_identity_shared_contacts_e688689b ON public.identity_shared_contacts USING btree (person_a_id);

CREATE INDEX IF NOT EXISTS ixfk_intelligence_outcomes_219bef17 ON public.intelligence_outcomes USING btree (actor_id);

CREATE INDEX IF NOT EXISTS ixfk_intelligence_outcomes_5003a32c ON public.intelligence_outcomes USING btree (action_id);

CREATE INDEX IF NOT EXISTS ixfk_intelligence_outcomes_b078201d ON public.intelligence_outcomes USING btree (feedback_id);

CREATE INDEX IF NOT EXISTS ixfk_invitations_bc307346 ON public.invitations USING btree (created_by);

CREATE INDEX IF NOT EXISTS ixfk_invitations_c7d1ce1b ON public.invitations USING btree (accepted_by);

CREATE INDEX IF NOT EXISTS ixfk_lifecycle_stages_837aa764 ON public.lifecycle_stages USING btree (organization_id, created_by);

CREATE INDEX IF NOT EXISTS ixfk_organization_invitations_b8b816af ON public.organization_invitations USING btree (accepted_by);

CREATE INDEX IF NOT EXISTS ixfk_organization_invites_542896d5 ON public.organization_invites USING btree (invited_by);

CREATE INDEX IF NOT EXISTS ixfk_organization_invites_dbb4b867 ON public.organization_invites USING btree (accepted_by);

CREATE INDEX IF NOT EXISTS ixfk_people_53857ca7 ON public.people USING btree (organization_id, created_by);

CREATE INDEX IF NOT EXISTS ixfk_people_6ae7510c ON public.people USING btree (last_scan_job_id);

CREATE INDEX IF NOT EXISTS ixfk_people_944bd1d4 ON public.people USING btree (created_by);

CREATE INDEX IF NOT EXISTS ixfk_people_e1a38d04 ON public.people USING btree (organization_id, last_scan_job_id);

CREATE INDEX IF NOT EXISTS ixfk_person_aliases_231f15bb ON public.person_aliases USING btree (person_id);

CREATE INDEX IF NOT EXISTS ixfk_person_aliases_24ed6112 ON public.person_aliases USING btree (created_by);

CREATE INDEX IF NOT EXISTS ixfk_person_aliases_faa7e89d ON public.person_aliases USING btree (organization_id, created_by);

CREATE INDEX IF NOT EXISTS ixfk_person_communications_22cad510 ON public.person_communications USING btree (organization_id, created_by);

CREATE INDEX IF NOT EXISTS ixfk_person_create_requests_b225b828 ON public.person_create_requests USING btree (created_by);

CREATE INDEX IF NOT EXISTS ixfk_person_documents_8d413844 ON public.person_documents USING btree (organization_id, created_by);

CREATE INDEX IF NOT EXISTS ixfk_person_field_definitions_4e9ee1d2 ON public.person_field_definitions USING btree (organization_id, created_by);

CREATE INDEX IF NOT EXISTS ixfk_person_field_values_a9acf668 ON public.person_field_values USING btree (organization_id, field_id);

CREATE INDEX IF NOT EXISTS ixfk_person_identity_review_items_209cf442 ON public.person_identity_review_items USING btree (resolved_person_id);

CREATE INDEX IF NOT EXISTS ixfk_person_identity_review_items_7f320a66 ON public.person_identity_review_items USING btree (created_by);

CREATE INDEX IF NOT EXISTS ixfk_person_identity_review_items_e5acbf32 ON public.person_identity_review_items USING btree (resolved_by);

CREATE INDEX IF NOT EXISTS ixfk_person_lifecycle_9f6d7d7c ON public.person_lifecycle USING btree (organization_id, changed_by);

CREATE INDEX IF NOT EXISTS ixfk_person_memberships_fbb86372 ON public.person_memberships USING btree (organization_id, created_by);

CREATE INDEX IF NOT EXISTS ixfk_person_relationships_97e7d86c ON public.person_relationships USING btree (organization_id, related_person_id);

CREATE INDEX IF NOT EXISTS ixfk_person_roles_c7023426 ON public.person_roles USING btree (organization_id, created_by);

CREATE INDEX IF NOT EXISTS ixfk_person_segments_fb311ed0 ON public.person_segments USING btree (organization_id, created_by);

CREATE INDEX IF NOT EXISTS ixfk_person_tasks_56302a94 ON public.person_tasks USING btree (organization_id, created_by);

CREATE INDEX IF NOT EXISTS ixfk_person_views_f14b9a0c ON public.person_views USING btree (organization_id, created_by);

CREATE INDEX IF NOT EXISTS ixfk_session_group_owners_d92eae2a ON public.session_group_owners USING btree (organization_id, user_id);

CREATE INDEX IF NOT EXISTS ixfk_session_group_owners_f23c081f ON public.session_group_owners USING btree (organization_id, session_id);

CREATE INDEX IF NOT EXISTS ixfk_session_sections_1b47d167 ON public.session_sections USING btree (organization_id, session_id);

CREATE INDEX IF NOT EXISTS ixfk_sessions_8fd430a9 ON public.sessions USING btree (started_by);

CREATE INDEX IF NOT EXISTS ixfk_sessions_d86c1724 ON public.sessions USING btree (closed_by);

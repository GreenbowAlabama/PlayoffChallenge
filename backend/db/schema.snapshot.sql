--
-- PostgreSQL database dump
--

\restrict 3mPVnFZgxSeXISdgqpnQgtJ2LW7aAN4XfRDoqppc48pdwLQdc0KFeCowlCSjbgF

-- Dumped from database version 17.7 (Debian 17.7-3.pgdg13+1)
-- Dumped by pg_dump version 17.6 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

ALTER TABLE IF EXISTS ONLY public.tournament_configs DROP CONSTRAINT IF EXISTS tournament_configs_contest_instance_id_fkey;
ALTER TABLE IF EXISTS ONLY public.tournament_config_versions DROP CONSTRAINT IF EXISTS tournament_config_versions_tournament_config_id_fkey;
ALTER TABLE IF EXISTS ONLY public.settlement_records DROP CONSTRAINT IF EXISTS settlement_records_contest_instance_id_fkey;
ALTER TABLE IF EXISTS ONLY public.settlement_audit DROP CONSTRAINT IF EXISTS settlement_audit_contest_instance_id_fkey;
ALTER TABLE IF EXISTS ONLY public.scoring_audit DROP CONSTRAINT IF EXISTS scoring_audit_tournament_config_id_fkey;
ALTER TABLE IF EXISTS ONLY public.scoring_audit DROP CONSTRAINT IF EXISTS scoring_audit_contest_instance_id_fkey;
ALTER TABLE IF EXISTS ONLY public.scores DROP CONSTRAINT IF EXISTS scores_user_id_fkey;
ALTER TABLE IF EXISTS ONLY public.scores DROP CONSTRAINT IF EXISTS scores_player_id_fkey;
ALTER TABLE IF EXISTS ONLY public.score_history DROP CONSTRAINT IF EXISTS score_history_settlement_audit_id_fkey;
ALTER TABLE IF EXISTS ONLY public.score_history DROP CONSTRAINT IF EXISTS score_history_contest_instance_id_fkey;
ALTER TABLE IF EXISTS ONLY public.player_swaps DROP CONSTRAINT IF EXISTS player_swaps_user_id_fkey;
ALTER TABLE IF EXISTS ONLY public.player_swaps DROP CONSTRAINT IF EXISTS player_swaps_old_player_id_fkey;
ALTER TABLE IF EXISTS ONLY public.player_swaps DROP CONSTRAINT IF EXISTS player_swaps_new_player_id_fkey;
ALTER TABLE IF EXISTS ONLY public.picks DROP CONSTRAINT IF EXISTS picks_user_id_fkey;
ALTER TABLE IF EXISTS ONLY public.picks DROP CONSTRAINT IF EXISTS picks_player_id_fkey;
ALTER TABLE IF EXISTS ONLY public.picks DROP CONSTRAINT IF EXISTS picks_contest_instance_fk;
ALTER TABLE IF EXISTS ONLY public.pick_multipliers DROP CONSTRAINT IF EXISTS pick_multipliers_pick_id_fkey;
ALTER TABLE IF EXISTS ONLY public.payout_transfers DROP CONSTRAINT IF EXISTS payout_transfers_user_id_fkey;
ALTER TABLE IF EXISTS ONLY public.payout_transfers DROP CONSTRAINT IF EXISTS payout_transfers_payout_job_id_fkey;
ALTER TABLE IF EXISTS ONLY public.payout_transfers DROP CONSTRAINT IF EXISTS payout_transfers_contest_id_fkey;
ALTER TABLE IF EXISTS ONLY public.payout_requests DROP CONSTRAINT IF EXISTS payout_requests_user_id_fkey;
ALTER TABLE IF EXISTS ONLY public.payout_requests DROP CONSTRAINT IF EXISTS payout_requests_contest_instance_id_fkey;
ALTER TABLE IF EXISTS ONLY public.payout_jobs DROP CONSTRAINT IF EXISTS payout_jobs_contest_id_fkey;
ALTER TABLE IF EXISTS ONLY public.payment_intents DROP CONSTRAINT IF EXISTS payment_intents_user_id_fkey;
ALTER TABLE IF EXISTS ONLY public.payment_intents DROP CONSTRAINT IF EXISTS payment_intents_contest_instance_id_fkey;
ALTER TABLE IF EXISTS ONLY public.ledger DROP CONSTRAINT IF EXISTS ledger_user_id_fkey;
ALTER TABLE IF EXISTS ONLY public.ledger DROP CONSTRAINT IF EXISTS ledger_contest_instance_id_fkey;
ALTER TABLE IF EXISTS ONLY public.ingestion_validation_errors DROP CONSTRAINT IF EXISTS ingestion_validation_errors_ingestion_event_id_fkey;
ALTER TABLE IF EXISTS ONLY public.ingestion_validation_errors DROP CONSTRAINT IF EXISTS ingestion_validation_errors_contest_instance_id_fkey;
ALTER TABLE IF EXISTS ONLY public.ingestion_events DROP CONSTRAINT IF EXISTS ingestion_events_contest_instance_id_fkey;
ALTER TABLE IF EXISTS ONLY public.contest_participants DROP CONSTRAINT IF EXISTS fk_contest_participant_user;
ALTER TABLE IF EXISTS ONLY public.contest_participants DROP CONSTRAINT IF EXISTS fk_contest_participant_instance;
ALTER TABLE IF EXISTS ONLY public.contest_instances DROP CONSTRAINT IF EXISTS fk_contest_instance_template;
ALTER TABLE IF EXISTS ONLY public.contest_instances DROP CONSTRAINT IF EXISTS fk_contest_instance_organizer;
ALTER TABLE IF EXISTS ONLY public.field_selections DROP CONSTRAINT IF EXISTS field_selections_tournament_config_id_fkey;
ALTER TABLE IF EXISTS ONLY public.field_selections DROP CONSTRAINT IF EXISTS field_selections_contest_instance_id_fkey;
ALTER TABLE IF EXISTS ONLY public.admin_contest_audit DROP CONSTRAINT IF EXISTS admin_contest_audit_contest_fk;
ALTER TABLE IF EXISTS ONLY public.admin_contest_audit DROP CONSTRAINT IF EXISTS admin_contest_audit_admin_user_id_fkey;
DROP TRIGGER IF EXISTS update_users_updated_at ON public.users;
DROP TRIGGER IF EXISTS update_scoring_rules_updated_at ON public.scoring_rules;
DROP TRIGGER IF EXISTS update_rules_content_updated_at ON public.rules_content;
DROP TRIGGER IF EXISTS update_position_requirements_updated_at ON public.position_requirements;
DROP TRIGGER IF EXISTS update_pick_multipliers_updated_at ON public.pick_multipliers;
DROP TRIGGER IF EXISTS update_payout_structure_updated_at ON public.payout_structure;
DROP TRIGGER IF EXISTS trg_prevent_config_update ON public.tournament_configs;
DROP TRIGGER IF EXISTS trg_payout_transfers_set_updated_at ON public.payout_transfers;
DROP TRIGGER IF EXISTS stripe_events_no_update ON public.stripe_events;
DROP TRIGGER IF EXISTS settlement_audit_guard ON public.settlement_audit;
DROP TRIGGER IF EXISTS score_history_no_update ON public.score_history;
DROP TRIGGER IF EXISTS ledger_no_update ON public.ledger;
DROP TRIGGER IF EXISTS ingestion_validation_errors_no_update ON public.ingestion_validation_errors;
DROP TRIGGER IF EXISTS ingestion_events_no_update ON public.ingestion_events;
DROP TRIGGER IF EXISTS api_error_codes_block_update ON public.api_error_codes;
DROP TRIGGER IF EXISTS api_error_codes_block_delete ON public.api_error_codes;
DROP TRIGGER IF EXISTS api_contract_snapshots_block_update ON public.api_contract_snapshots;
DROP TRIGGER IF EXISTS api_contract_snapshots_block_delete ON public.api_contract_snapshots;
DROP INDEX IF EXISTS public.users_stripe_connected_account_id_unique;
DROP INDEX IF EXISTS public.unique_espn_id;
DROP INDEX IF EXISTS public.uniq_active_config;
DROP INDEX IF EXISTS public.stripe_webhook_dead_letters_event_id_idx;
DROP INDEX IF EXISTS public.stripe_events_stripe_event_id_uq;
DROP INDEX IF EXISTS public.payout_requests_idempotency_key_uq;
DROP INDEX IF EXISTS public.payment_intents_stripe_pi_id_uq;
DROP INDEX IF EXISTS public.payment_intents_idempotency_key_uq;
DROP INDEX IF EXISTS public.ledger_stripe_event_id_uq;
DROP INDEX IF EXISTS public.idx_users_state;
DROP INDEX IF EXISTS public.idx_users_eligibility;
DROP INDEX IF EXISTS public.idx_signup_attempts_state;
DROP INDEX IF EXISTS public.idx_signup_attempts_blocked;
DROP INDEX IF EXISTS public.idx_signup_attempts_attempted_at;
DROP INDEX IF EXISTS public.idx_signup_attempts_apple_id;
DROP INDEX IF EXISTS public.idx_settlement_records_settled_at;
DROP INDEX IF EXISTS public.idx_settlement_records_contest_instance;
DROP INDEX IF EXISTS public.idx_settlement_audit_status;
DROP INDEX IF EXISTS public.idx_settlement_audit_contest_started;
DROP INDEX IF EXISTS public.idx_scoring_rules_stat_name;
DROP INDEX IF EXISTS public.idx_scoring_rules_category;
DROP INDEX IF EXISTS public.idx_scores_week_user;
DROP INDEX IF EXISTS public.idx_scores_week_number;
DROP INDEX IF EXISTS public.idx_scores_week;
DROP INDEX IF EXISTS public.idx_scores_user_week;
DROP INDEX IF EXISTS public.idx_scores_user_id;
DROP INDEX IF EXISTS public.idx_score_history_contest_created;
DROP INDEX IF EXISTS public.idx_players_team;
DROP INDEX IF EXISTS public.idx_players_sleeper_id;
DROP INDEX IF EXISTS public.idx_players_position;
DROP INDEX IF EXISTS public.idx_players_espn_id;
DROP INDEX IF EXISTS public.idx_players_active;
DROP INDEX IF EXISTS public.idx_player_swaps_user_week;
DROP INDEX IF EXISTS public.idx_player_swaps_user_id;
DROP INDEX IF EXISTS public.idx_picks_week_user;
DROP INDEX IF EXISTS public.idx_picks_week_number;
DROP INDEX IF EXISTS public.idx_picks_week;
DROP INDEX IF EXISTS public.idx_picks_user_week;
DROP INDEX IF EXISTS public.idx_picks_user_id;
DROP INDEX IF EXISTS public.idx_pick_multipliers_pick_week;
DROP INDEX IF EXISTS public.idx_payout_transfers_status;
DROP INDEX IF EXISTS public.idx_payout_transfers_job_id;
DROP INDEX IF EXISTS public.idx_payout_transfers_contest_status;
DROP INDEX IF EXISTS public.idx_payout_requests_contest_user;
DROP INDEX IF EXISTS public.idx_payout_jobs_contest_id;
DROP INDEX IF EXISTS public.idx_payment_intents_contest_user;
DROP INDEX IF EXISTS public.idx_ledger_user_created;
DROP INDEX IF EXISTS public.idx_ledger_stripe_event_id;
DROP INDEX IF EXISTS public.idx_ledger_contest_created;
DROP INDEX IF EXISTS public.idx_ingestion_validation_errors_contest;
DROP INDEX IF EXISTS public.idx_ingestion_validation_errors_code;
DROP INDEX IF EXISTS public.idx_ingestion_events_validation_status;
DROP INDEX IF EXISTS public.idx_ingestion_events_payload_hash;
DROP INDEX IF EXISTS public.idx_ingestion_events_contest_received;
DROP INDEX IF EXISTS public.idx_contest_templates_template_type;
DROP INDEX IF EXISTS public.idx_contest_templates_sport;
DROP INDEX IF EXISTS public.idx_contest_templates_active;
DROP INDEX IF EXISTS public.idx_contest_participants_user;
DROP INDEX IF EXISTS public.idx_contest_participants_instance;
DROP INDEX IF EXISTS public.idx_contest_instances_template;
DROP INDEX IF EXISTS public.idx_contest_instances_status;
DROP INDEX IF EXISTS public.idx_contest_instances_organizer;
DROP INDEX IF EXISTS public.idx_contest_instances_lock_at;
DROP INDEX IF EXISTS public.idx_contest_instances_is_platform_owned;
DROP INDEX IF EXISTS public.idx_admin_contest_audit_status_transition;
DROP INDEX IF EXISTS public.idx_admin_contest_audit_created_at_desc;
DROP INDEX IF EXISTS public.idx_admin_contest_audit_contest;
DROP INDEX IF EXISTS public.idx_admin_contest_audit_admin;
DROP INDEX IF EXISTS public.api_contract_snapshots_unique;
ALTER TABLE IF EXISTS ONLY public.users DROP CONSTRAINT IF EXISTS users_pkey;
ALTER TABLE IF EXISTS ONLY public.users DROP CONSTRAINT IF EXISTS users_email_key;
ALTER TABLE IF EXISTS ONLY public.users DROP CONSTRAINT IF EXISTS users_apple_id_key;
ALTER TABLE IF EXISTS ONLY public.scores DROP CONSTRAINT IF EXISTS unique_user_player_week_score;
ALTER TABLE IF EXISTS ONLY public.ingestion_events DROP CONSTRAINT IF EXISTS unique_payload_per_contest;
ALTER TABLE IF EXISTS ONLY public.tournament_configs DROP CONSTRAINT IF EXISTS tournament_configs_pkey;
ALTER TABLE IF EXISTS ONLY public.tournament_config_versions DROP CONSTRAINT IF EXISTS tournament_config_versions_pkey;
ALTER TABLE IF EXISTS ONLY public.stripe_webhook_dead_letters DROP CONSTRAINT IF EXISTS stripe_webhook_dead_letters_pkey;
ALTER TABLE IF EXISTS ONLY public.stripe_events DROP CONSTRAINT IF EXISTS stripe_events_pkey;
ALTER TABLE IF EXISTS ONLY public.signup_attempts DROP CONSTRAINT IF EXISTS signup_attempts_pkey;
ALTER TABLE IF EXISTS ONLY public.settlement_records DROP CONSTRAINT IF EXISTS settlement_records_pkey;
ALTER TABLE IF EXISTS ONLY public.settlement_records DROP CONSTRAINT IF EXISTS settlement_records_one_per_contest;
ALTER TABLE IF EXISTS ONLY public.settlement_audit DROP CONSTRAINT IF EXISTS settlement_audit_pkey;
ALTER TABLE IF EXISTS ONLY public.settlement_audit DROP CONSTRAINT IF EXISTS settlement_audit_contest_instance_id_settlement_run_id_key;
ALTER TABLE IF EXISTS ONLY public.scoring_rules DROP CONSTRAINT IF EXISTS scoring_rules_pkey;
ALTER TABLE IF EXISTS ONLY public.scoring_audit DROP CONSTRAINT IF EXISTS scoring_audit_pkey;
ALTER TABLE IF EXISTS ONLY public.scores DROP CONSTRAINT IF EXISTS scores_pkey;
ALTER TABLE IF EXISTS ONLY public.score_history DROP CONSTRAINT IF EXISTS score_history_pkey;
ALTER TABLE IF EXISTS ONLY public.score_history DROP CONSTRAINT IF EXISTS score_history_contest_instance_id_settlement_audit_id_key;
ALTER TABLE IF EXISTS ONLY public.rules_content DROP CONSTRAINT IF EXISTS rules_content_section_key;
ALTER TABLE IF EXISTS ONLY public.rules_content DROP CONSTRAINT IF EXISTS rules_content_pkey;
ALTER TABLE IF EXISTS ONLY public.position_requirements DROP CONSTRAINT IF EXISTS position_requirements_position_key;
ALTER TABLE IF EXISTS ONLY public.position_requirements DROP CONSTRAINT IF EXISTS position_requirements_pkey;
ALTER TABLE IF EXISTS ONLY public.players DROP CONSTRAINT IF EXISTS players_sleeper_id_unique;
ALTER TABLE IF EXISTS ONLY public.players DROP CONSTRAINT IF EXISTS players_pkey;
ALTER TABLE IF EXISTS ONLY public.player_swaps DROP CONSTRAINT IF EXISTS player_swaps_pkey;
ALTER TABLE IF EXISTS ONLY public.picks DROP CONSTRAINT IF EXISTS picks_pkey;
ALTER TABLE IF EXISTS ONLY public.picks DROP CONSTRAINT IF EXISTS picks_contest_user_player_week_key;
ALTER TABLE IF EXISTS ONLY public.pick_multipliers DROP CONSTRAINT IF EXISTS pick_multipliers_pkey;
ALTER TABLE IF EXISTS ONLY public.pick_multipliers DROP CONSTRAINT IF EXISTS pick_multipliers_pick_id_week_number_key;
ALTER TABLE IF EXISTS ONLY public.payouts DROP CONSTRAINT IF EXISTS payouts_place_key;
ALTER TABLE IF EXISTS ONLY public.payouts DROP CONSTRAINT IF EXISTS payouts_pkey;
ALTER TABLE IF EXISTS ONLY public.payout_transfers DROP CONSTRAINT IF EXISTS payout_transfers_pkey;
ALTER TABLE IF EXISTS ONLY public.payout_transfers DROP CONSTRAINT IF EXISTS payout_transfers_idempotency_key_key;
ALTER TABLE IF EXISTS ONLY public.payout_transfers DROP CONSTRAINT IF EXISTS payout_transfers_contest_id_user_id_key;
ALTER TABLE IF EXISTS ONLY public.payout_structure DROP CONSTRAINT IF EXISTS payout_structure_place_key;
ALTER TABLE IF EXISTS ONLY public.payout_structure DROP CONSTRAINT IF EXISTS payout_structure_pkey;
ALTER TABLE IF EXISTS ONLY public.payout_requests DROP CONSTRAINT IF EXISTS payout_requests_pkey;
ALTER TABLE IF EXISTS ONLY public.payout_jobs DROP CONSTRAINT IF EXISTS payout_jobs_settlement_id_key;
ALTER TABLE IF EXISTS ONLY public.payout_jobs DROP CONSTRAINT IF EXISTS payout_jobs_pkey;
ALTER TABLE IF EXISTS ONLY public.payment_intents DROP CONSTRAINT IF EXISTS payment_intents_pkey;
ALTER TABLE IF EXISTS ONLY public.ledger DROP CONSTRAINT IF EXISTS ledger_pkey;
ALTER TABLE IF EXISTS ONLY public.ledger DROP CONSTRAINT IF EXISTS ledger_idempotency_key_unique;
ALTER TABLE IF EXISTS ONLY public.ingestion_validation_errors DROP CONSTRAINT IF EXISTS ingestion_validation_errors_pkey;
ALTER TABLE IF EXISTS ONLY public.ingestion_events DROP CONSTRAINT IF EXISTS ingestion_events_pkey;
ALTER TABLE IF EXISTS ONLY public.game_settings DROP CONSTRAINT IF EXISTS game_settings_pkey;
ALTER TABLE IF EXISTS ONLY public.field_selections DROP CONSTRAINT IF EXISTS field_selections_pkey;
ALTER TABLE IF EXISTS ONLY public.contest_templates DROP CONSTRAINT IF EXISTS contest_templates_pkey;
ALTER TABLE IF EXISTS ONLY public.contest_participants DROP CONSTRAINT IF EXISTS contest_participants_pkey;
ALTER TABLE IF EXISTS ONLY public.contest_participants DROP CONSTRAINT IF EXISTS contest_participants_instance_user_unique;
ALTER TABLE IF EXISTS ONLY public.contest_instances DROP CONSTRAINT IF EXISTS contest_instances_pkey;
ALTER TABLE IF EXISTS ONLY public.contest_instances DROP CONSTRAINT IF EXISTS contest_instances_join_token_key;
ALTER TABLE IF EXISTS ONLY public.api_error_codes DROP CONSTRAINT IF EXISTS api_error_codes_pkey;
ALTER TABLE IF EXISTS ONLY public.api_contract_snapshots DROP CONSTRAINT IF EXISTS api_contract_snapshots_pkey;
ALTER TABLE IF EXISTS ONLY public.admin_contest_audit DROP CONSTRAINT IF EXISTS admin_contest_audit_pkey;
ALTER TABLE IF EXISTS public.signup_attempts ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.scoring_rules ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.rules_content ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.position_requirements ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.player_swaps ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.pick_multipliers ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.payouts ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.payout_structure ALTER COLUMN id DROP DEFAULT;
DROP VIEW IF EXISTS public.v_game_status;
DROP TABLE IF EXISTS public.users;
DROP TABLE IF EXISTS public.tournament_configs;
DROP TABLE IF EXISTS public.tournament_config_versions;
DROP TABLE IF EXISTS public.stripe_webhook_dead_letters;
DROP TABLE IF EXISTS public.stripe_events;
DROP SEQUENCE IF EXISTS public.signup_attempts_id_seq;
DROP TABLE IF EXISTS public.signup_attempts;
DROP TABLE IF EXISTS public.settlement_records;
DROP TABLE IF EXISTS public.settlement_audit;
DROP SEQUENCE IF EXISTS public.scoring_rules_id_seq;
DROP TABLE IF EXISTS public.scoring_rules;
DROP TABLE IF EXISTS public.scoring_audit;
DROP TABLE IF EXISTS public.scores;
DROP TABLE IF EXISTS public.score_history;
DROP SEQUENCE IF EXISTS public.rules_content_id_seq;
DROP TABLE IF EXISTS public.rules_content;
DROP SEQUENCE IF EXISTS public.position_requirements_id_seq;
DROP TABLE IF EXISTS public.position_requirements;
DROP TABLE IF EXISTS public.players;
DROP SEQUENCE IF EXISTS public.player_swaps_id_seq;
DROP TABLE IF EXISTS public.player_swaps;
DROP TABLE IF EXISTS public.picks;
DROP SEQUENCE IF EXISTS public.pick_multipliers_id_seq;
DROP TABLE IF EXISTS public.pick_multipliers;
DROP SEQUENCE IF EXISTS public.payouts_id_seq;
DROP TABLE IF EXISTS public.payouts;
DROP TABLE IF EXISTS public.payout_transfers;
DROP SEQUENCE IF EXISTS public.payout_structure_id_seq;
DROP TABLE IF EXISTS public.payout_structure;
DROP TABLE IF EXISTS public.payout_requests;
DROP TABLE IF EXISTS public.payout_jobs;
DROP TABLE IF EXISTS public.payment_intents;
DROP TABLE IF EXISTS public.ledger;
DROP TABLE IF EXISTS public.ingestion_validation_errors;
DROP TABLE IF EXISTS public.ingestion_events;
DROP TABLE IF EXISTS public.game_settings;
DROP TABLE IF EXISTS public.field_selections;
DROP TABLE IF EXISTS public.contest_templates;
DROP TABLE IF EXISTS public.contest_participants;
DROP TABLE IF EXISTS public.contest_instances;
DROP VIEW IF EXISTS public.api_error_codes_public;
DROP TABLE IF EXISTS public.api_error_codes;
DROP VIEW IF EXISTS public.api_contract_snapshots_latest;
DROP TABLE IF EXISTS public.api_contract_snapshots;
DROP TABLE IF EXISTS public.admin_contest_audit;
DROP FUNCTION IF EXISTS public.update_updated_at_column();
DROP FUNCTION IF EXISTS public.set_updated_at();
DROP FUNCTION IF EXISTS public.prevent_updates_deletes();
DROP FUNCTION IF EXISTS public.prevent_settlement_audit_illegal_update();
DROP FUNCTION IF EXISTS public.prevent_config_update_when_locked();
DROP FUNCTION IF EXISTS public.get_playoff_week_number(nfl_week integer);
DROP FUNCTION IF EXISTS public.get_nfl_week_number(playoff_week integer);
DROP FUNCTION IF EXISTS public.api_error_codes_no_update_delete();
DROP FUNCTION IF EXISTS public.api_contract_snapshots_no_update_delete();
DROP EXTENSION IF EXISTS pgcrypto;
--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: api_contract_snapshots_no_update_delete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.api_contract_snapshots_no_update_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'api_contract_snapshots is append-only';
END;
$$;


--
-- Name: api_error_codes_no_update_delete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.api_error_codes_no_update_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'api_error_codes is append-only (add new rows only)';
END;
$$;


--
-- Name: get_nfl_week_number(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_nfl_week_number(playoff_week integer) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  start_week INT;
BEGIN
  SELECT playoff_start_week INTO start_week FROM game_settings LIMIT 1;
  
  -- playoff_week 1 = Wild Card = start_week
  -- playoff_week 2 = Divisional = start_week + 1
  -- playoff_week 3 = Conference = start_week + 2
  -- playoff_week 4 = Super Bowl = start_week + 3
  
  RETURN start_week + (playoff_week - 1);
END;
$$;


--
-- Name: get_playoff_week_number(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_playoff_week_number(nfl_week integer) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  start_week INT;
BEGIN
  SELECT playoff_start_week INTO start_week FROM game_settings LIMIT 1;
  
  -- Return the playoff round number (1-4)
  RETURN nfl_week - start_week + 1;
END;
$$;


--
-- Name: prevent_config_update_when_locked(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_config_update_when_locked() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  contest_status text;
BEGIN
  SELECT status INTO contest_status
  FROM contest_instances
  WHERE id = OLD.contest_instance_id;

  IF contest_status IN ('LOCKED', 'LIVE') THEN
    RAISE EXCEPTION 'CONFIG_IMMUTABLE_DURING_LOCKED_OR_LIVE';
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: prevent_settlement_audit_illegal_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_settlement_audit_illegal_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_old_status TEXT;
  v_new_status TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'settlement_audit is append-only: deletions are not allowed';
  END IF;

  IF TG_OP = 'UPDATE' THEN

    IF NEW.contest_instance_id IS DISTINCT FROM OLD.contest_instance_id THEN
      RAISE EXCEPTION 'settlement_audit identity field contest_instance_id is immutable';
    END IF;

    IF NEW.settlement_run_id IS DISTINCT FROM OLD.settlement_run_id THEN
      RAISE EXCEPTION 'settlement_audit identity field settlement_run_id is immutable';
    END IF;

    IF NEW.engine_version IS DISTINCT FROM OLD.engine_version THEN
      RAISE EXCEPTION 'settlement_audit identity field engine_version is immutable';
    END IF;

    IF NEW.event_ids_applied IS DISTINCT FROM OLD.event_ids_applied THEN
      RAISE EXCEPTION 'settlement_audit identity field event_ids_applied is immutable';
    END IF;

    IF NEW.started_at IS DISTINCT FROM OLD.started_at THEN
      RAISE EXCEPTION 'settlement_audit identity field started_at is immutable';
    END IF;

    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'settlement_audit identity field created_at is immutable';
    END IF;

    v_old_status := OLD.status;
    v_new_status := NEW.status;

    IF v_new_status IS DISTINCT FROM v_old_status THEN
      IF v_old_status != 'STARTED' THEN
        RAISE EXCEPTION 'settlement_audit status % cannot transition to %', v_old_status, v_new_status;
      END IF;

      IF v_new_status NOT IN ('COMPLETE', 'FAILED') THEN
        RAISE EXCEPTION 'settlement_audit status STARTED can only transition to COMPLETE or FAILED, not %', v_new_status;
      END IF;

      IF NEW.completed_at IS NULL THEN
        RAISE EXCEPTION 'settlement_audit completed_at must be set when transitioning from STARTED to %', v_new_status;
      END IF;
    ELSE
      IF v_old_status = 'STARTED' AND NEW.completed_at IS NOT NULL THEN
        RAISE EXCEPTION 'settlement_audit completed_at must remain NULL while status is STARTED';
      END IF;
    END IF;

    IF NEW.status = 'STARTED' AND NEW.completed_at IS NOT NULL THEN
      RAISE EXCEPTION 'settlement_audit completed_at must be NULL when status is STARTED';
    END IF;

    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: prevent_updates_deletes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_updates_deletes() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION 'Append-only table: updates and deletes are not allowed';
END;
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: admin_contest_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_contest_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contest_instance_id uuid NOT NULL,
    admin_user_id uuid NOT NULL,
    action text NOT NULL,
    reason text NOT NULL,
    payload jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    from_status text NOT NULL,
    to_status text NOT NULL
);


--
-- Name: api_contract_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.api_contract_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contract_name text NOT NULL,
    version text NOT NULL,
    sha256 text NOT NULL,
    spec_json jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: api_contract_snapshots_latest; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.api_contract_snapshots_latest AS
 SELECT DISTINCT ON (contract_name) contract_name,
    version,
    sha256,
    created_at
   FROM public.api_contract_snapshots
  ORDER BY contract_name, created_at DESC;


--
-- Name: api_error_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.api_error_codes (
    code text NOT NULL,
    http_status integer NOT NULL,
    scope text NOT NULL,
    description text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: api_error_codes_public; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.api_error_codes_public AS
 SELECT code,
    http_status,
    description
   FROM public.api_error_codes
  WHERE (scope = 'public'::text)
  ORDER BY code;


--
-- Name: contest_instances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contest_instances (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    template_id uuid NOT NULL,
    organizer_id uuid NOT NULL,
    entry_fee_cents integer NOT NULL,
    payout_structure jsonb NOT NULL,
    status text NOT NULL,
    start_time timestamp with time zone,
    lock_time timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    join_token text,
    max_entries integer DEFAULT 20 NOT NULL,
    lock_at timestamp with time zone,
    contest_name text NOT NULL,
    end_time timestamp with time zone,
    settle_time timestamp with time zone,
    is_platform_owned boolean DEFAULT false NOT NULL,
    CONSTRAINT entry_fee_non_negative CHECK ((entry_fee_cents >= 0)),
    CONSTRAINT max_entries_positive CHECK (((max_entries IS NULL) OR (max_entries > 0))),
    CONSTRAINT status_valid CHECK ((status = ANY (ARRAY['SCHEDULED'::text, 'LOCKED'::text, 'LIVE'::text, 'COMPLETE'::text, 'CANCELLED'::text, 'ERROR'::text])))
);


--
-- Name: contest_participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contest_participants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contest_instance_id uuid NOT NULL,
    user_id uuid NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: contest_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contest_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    sport text NOT NULL,
    template_type text NOT NULL,
    scoring_strategy_key text NOT NULL,
    lock_strategy_key text NOT NULL,
    settlement_strategy_key text NOT NULL,
    default_entry_fee_cents integer NOT NULL,
    allowed_entry_fee_min_cents integer NOT NULL,
    allowed_entry_fee_max_cents integer NOT NULL,
    allowed_payout_structures jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: field_selections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.field_selections (
    id uuid NOT NULL,
    contest_instance_id uuid NOT NULL,
    tournament_config_id uuid NOT NULL,
    selection_json jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: game_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entry_amount character varying(10) DEFAULT '50'::character varying,
    venmo_handle character varying(100),
    cashapp_handle character varying(100),
    zelle_handle character varying(100),
    game_mode character varying(50) DEFAULT 'traditional'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    qb_limit integer DEFAULT 1,
    rb_limit integer DEFAULT 2,
    wr_limit integer DEFAULT 3,
    te_limit integer DEFAULT 1,
    k_limit integer DEFAULT 1,
    def_limit integer DEFAULT 1,
    playoff_start_week integer DEFAULT 19,
    current_playoff_week integer DEFAULT 0,
    season_year character varying(4) DEFAULT '2024'::character varying,
    is_week_active boolean DEFAULT true,
    active_teams text[]
);


--
-- Name: ingestion_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ingestion_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contest_instance_id uuid NOT NULL,
    provider text NOT NULL,
    event_type text NOT NULL,
    provider_data_json jsonb NOT NULL,
    payload_hash text NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    validated_at timestamp with time zone,
    validation_status text NOT NULL,
    validation_errors_json jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ingestion_events_validation_status_check CHECK ((validation_status = ANY (ARRAY['VALID'::text, 'INVALID'::text])))
);


--
-- Name: ingestion_validation_errors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ingestion_validation_errors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ingestion_event_id uuid NOT NULL,
    contest_instance_id uuid NOT NULL,
    error_code text NOT NULL,
    error_details_json jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ledger (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contest_instance_id uuid,
    user_id uuid,
    entry_type text NOT NULL,
    direction text NOT NULL,
    amount_cents integer NOT NULL,
    currency text DEFAULT 'USD'::text NOT NULL,
    reference_type text,
    reference_id uuid,
    idempotency_key text NOT NULL,
    metadata_json jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    stripe_event_id text,
    CONSTRAINT ledger_amount_cents_check CHECK ((amount_cents >= 0)),
    CONSTRAINT ledger_direction_check CHECK ((direction = ANY (ARRAY['CREDIT'::text, 'DEBIT'::text]))),
    CONSTRAINT ledger_entry_type_check CHECK ((entry_type = ANY (ARRAY['ENTRY_FEE'::text, 'ENTRY_FEE_REFUND'::text, 'PRIZE_PAYOUT'::text, 'PRIZE_PAYOUT_REVERSAL'::text, 'ADJUSTMENT'::text])))
);


--
-- Name: payment_intents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_intents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contest_instance_id uuid NOT NULL,
    user_id uuid NOT NULL,
    idempotency_key text NOT NULL,
    stripe_payment_intent_id text,
    stripe_customer_id text,
    status text NOT NULL,
    amount_cents integer NOT NULL,
    currency text DEFAULT 'USD'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    stripe_client_secret text,
    CONSTRAINT payment_intents_amount_cents_check CHECK ((amount_cents >= 0)),
    CONSTRAINT payment_intents_status_check CHECK ((status = ANY (ARRAY['REQUIRES_PAYMENT_METHOD'::text, 'REQUIRES_CONFIRMATION'::text, 'REQUIRES_ACTION'::text, 'PROCESSING'::text, 'SUCCEEDED'::text, 'CANCELED'::text, 'FAILED'::text])))
);


--
-- Name: payout_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payout_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    settlement_id uuid NOT NULL,
    contest_id uuid NOT NULL,
    status text NOT NULL,
    total_payouts integer DEFAULT 0 NOT NULL,
    completed_count integer DEFAULT 0 NOT NULL,
    failed_count integer DEFAULT 0 NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payout_jobs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'complete'::text])))
);


--
-- Name: payout_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payout_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contest_instance_id uuid NOT NULL,
    user_id uuid NOT NULL,
    idempotency_key text NOT NULL,
    amount_cents integer NOT NULL,
    currency text DEFAULT 'USD'::text NOT NULL,
    status text DEFAULT 'REQUESTED'::text NOT NULL,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone,
    processor_ref text,
    error_code text,
    error_details_json jsonb,
    CONSTRAINT payout_requests_amount_cents_check CHECK ((amount_cents >= 0)),
    CONSTRAINT payout_requests_status_check CHECK ((status = ANY (ARRAY['REQUESTED'::text, 'PROCESSING'::text, 'SUCCEEDED'::text, 'FAILED'::text, 'CANCELED'::text])))
);


--
-- Name: payout_structure; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payout_structure (
    id integer NOT NULL,
    place integer NOT NULL,
    percentage numeric(5,2) NOT NULL,
    description character varying(100),
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: payout_structure_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payout_structure_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payout_structure_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payout_structure_id_seq OWNED BY public.payout_structure.id;


--
-- Name: payout_transfers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payout_transfers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payout_job_id uuid NOT NULL,
    contest_id uuid NOT NULL,
    user_id uuid NOT NULL,
    amount_cents integer NOT NULL,
    status text NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 3 NOT NULL,
    stripe_transfer_id text,
    idempotency_key text NOT NULL,
    failure_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payout_transfers_amount_cents_check CHECK ((amount_cents > 0)),
    CONSTRAINT payout_transfers_attempt_count_check CHECK ((attempt_count >= 0)),
    CONSTRAINT payout_transfers_max_attempts_check CHECK ((max_attempts >= 1)),
    CONSTRAINT payout_transfers_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'retryable'::text, 'completed'::text, 'failed_terminal'::text])))
);


--
-- Name: payouts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payouts (
    id integer NOT NULL,
    place integer NOT NULL,
    percentage numeric(5,2) NOT NULL,
    description text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: payouts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payouts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payouts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payouts_id_seq OWNED BY public.payouts.id;


--
-- Name: pick_multipliers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pick_multipliers (
    id integer NOT NULL,
    pick_id uuid NOT NULL,
    week_number integer NOT NULL,
    consecutive_weeks integer DEFAULT 1,
    multiplier numeric(3,1) DEFAULT 1.0,
    is_bye_week boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: pick_multipliers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pick_multipliers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pick_multipliers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pick_multipliers_id_seq OWNED BY public.pick_multipliers.id;


--
-- Name: picks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.picks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    player_id character varying(50),
    week_number integer NOT NULL,
    locked boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    "position" character varying(10),
    consecutive_weeks integer DEFAULT 0,
    multiplier numeric(3,1) DEFAULT 1.0,
    is_bye_week boolean DEFAULT false,
    contest_instance_id uuid NOT NULL
);


--
-- Name: player_swaps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.player_swaps (
    id integer NOT NULL,
    user_id uuid NOT NULL,
    old_player_id character varying NOT NULL,
    new_player_id character varying NOT NULL,
    "position" character varying(10) NOT NULL,
    week_number integer NOT NULL,
    swapped_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: player_swaps_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.player_swaps_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: player_swaps_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.player_swaps_id_seq OWNED BY public.player_swaps.id;


--
-- Name: players; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.players (
    id character varying(50) NOT NULL,
    "position" character varying(10),
    team character varying(10),
    available boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    sleeper_id character varying(50),
    full_name character varying(100),
    is_active boolean DEFAULT true,
    game_time timestamp without time zone,
    first_name character varying(100),
    last_name character varying(100),
    status character varying(50) DEFAULT 'Unknown'::character varying,
    injury_status character varying(100),
    years_exp integer DEFAULT 0,
    number character varying(10),
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    espn_id character varying(50),
    image_url character varying(255)
);


--
-- Name: position_requirements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.position_requirements (
    id integer NOT NULL,
    "position" character varying(10) NOT NULL,
    required_count integer NOT NULL,
    display_name character varying(50) NOT NULL,
    display_order integer DEFAULT 0,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: position_requirements_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.position_requirements_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: position_requirements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.position_requirements_id_seq OWNED BY public.position_requirements.id;


--
-- Name: rules_content; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rules_content (
    id integer NOT NULL,
    section character varying(50) NOT NULL,
    content text NOT NULL,
    display_order integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: rules_content_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rules_content_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rules_content_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rules_content_id_seq OWNED BY public.rules_content.id;


--
-- Name: score_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.score_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contest_instance_id uuid NOT NULL,
    settlement_audit_id uuid NOT NULL,
    scores_json jsonb NOT NULL,
    scores_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scores (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    player_id character varying(50),
    week_number integer NOT NULL,
    points numeric(10,2) DEFAULT 0,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    base_points numeric(10,2) DEFAULT 0,
    multiplier numeric(3,1) DEFAULT 1.0,
    final_points numeric(10,2) DEFAULT 0,
    stats_json jsonb
);


--
-- Name: scoring_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scoring_audit (
    id uuid NOT NULL,
    contest_instance_id uuid NOT NULL,
    tournament_config_id uuid NOT NULL,
    provider_payload_hash text NOT NULL,
    scoring_output_hash text NOT NULL,
    scoring_json jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: scoring_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scoring_rules (
    id integer NOT NULL,
    category character varying(50) NOT NULL,
    stat_name character varying(100) NOT NULL,
    points numeric(5,2) NOT NULL,
    description text,
    is_active boolean DEFAULT true,
    display_order integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: scoring_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.scoring_rules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: scoring_rules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.scoring_rules_id_seq OWNED BY public.scoring_rules.id;


--
-- Name: settlement_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settlement_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contest_instance_id uuid NOT NULL,
    settlement_run_id uuid NOT NULL,
    engine_version text NOT NULL,
    event_ids_applied uuid[] NOT NULL,
    started_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone,
    status text NOT NULL,
    error_json jsonb,
    final_scores_json jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT settlement_audit_status_check CHECK ((status = ANY (ARRAY['STARTED'::text, 'COMPLETE'::text, 'FAILED'::text])))
);


--
-- Name: settlement_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settlement_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contest_instance_id uuid NOT NULL,
    settled_at timestamp with time zone DEFAULT now() NOT NULL,
    results jsonb NOT NULL,
    results_sha256 text NOT NULL,
    settlement_version text DEFAULT 'v1'::text NOT NULL,
    participant_count integer NOT NULL,
    total_pool_cents integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: signup_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.signup_attempts (
    id integer NOT NULL,
    apple_id character varying(255),
    email character varying(255),
    name character varying(255),
    attempted_state character varying(2),
    ip_state_verified character varying(2),
    blocked boolean DEFAULT false,
    blocked_reason character varying(100),
    attempted_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: signup_attempts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.signup_attempts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: signup_attempts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.signup_attempts_id_seq OWNED BY public.signup_attempts.id;


--
-- Name: stripe_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stripe_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    stripe_event_id text NOT NULL,
    event_type text NOT NULL,
    raw_payload_json jsonb NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone,
    processing_status text DEFAULT 'RECEIVED'::text NOT NULL,
    processing_error_code text,
    processing_error_details_json jsonb,
    CONSTRAINT stripe_events_processing_status_check CHECK ((processing_status = ANY (ARRAY['RECEIVED'::text, 'PROCESSED'::text, 'FAILED'::text])))
);


--
-- Name: stripe_webhook_dead_letters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stripe_webhook_dead_letters (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    stripe_event_id text,
    event_type text,
    failure_class text NOT NULL,
    error_json jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tournament_config_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tournament_config_versions (
    id uuid NOT NULL,
    tournament_config_id uuid NOT NULL,
    version integer NOT NULL,
    config_json jsonb NOT NULL,
    hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tournament_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tournament_configs (
    id uuid NOT NULL,
    contest_instance_id uuid NOT NULL,
    provider_event_id text NOT NULL,
    ingestion_endpoint text NOT NULL,
    event_start_date timestamp with time zone NOT NULL,
    event_end_date timestamp with time zone NOT NULL,
    round_count integer DEFAULT 4 NOT NULL,
    cut_after_round integer,
    leaderboard_schema_version integer NOT NULL,
    field_source text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    published_at timestamp with time zone NOT NULL,
    is_active boolean DEFAULT false NOT NULL,
    hash text NOT NULL,
    CONSTRAINT tournament_configs_check CHECK (((cut_after_round IS NULL) OR ((cut_after_round >= 1) AND (cut_after_round <= round_count)))),
    CONSTRAINT tournament_configs_field_source_check CHECK ((field_source = ANY (ARRAY['provider_sync'::text, 'static_import'::text]))),
    CONSTRAINT tournament_configs_round_count_check CHECK ((round_count > 0))
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    username character varying(100),
    team_name character varying(100),
    paid boolean DEFAULT false,
    payment_method character varying(50),
    payment_date timestamp without time zone,
    is_admin boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    email character varying(255),
    apple_id character varying(255),
    name character varying(255),
    updated_at timestamp without time zone DEFAULT now(),
    phone character varying(50),
    state character varying(2),
    ip_state_verified character varying(2),
    state_certification_date timestamp without time zone,
    eligibility_confirmed_at timestamp without time zone,
    tos_version character varying(20),
    tos_accepted_at timestamp without time zone,
    age_verified boolean DEFAULT false,
    password_hash character varying(255),
    auth_method character varying(20) DEFAULT 'apple'::character varying,
    admin_notes text,
    stripe_connected_account_id text
);


--
-- Name: v_game_status; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_game_status AS
 SELECT playoff_start_week,
    current_playoff_week,
    season_year,
        CASE
            WHEN (current_playoff_week = 0) THEN 'Not Started'::text
            WHEN (current_playoff_week = 1) THEN 'Wild Card Round'::text
            WHEN (current_playoff_week = 2) THEN 'Divisional Round'::text
            WHEN (current_playoff_week = 3) THEN 'Conference Championships'::text
            WHEN (current_playoff_week = 4) THEN 'Super Bowl'::text
            ELSE 'Season Complete'::text
        END AS current_round,
    public.get_nfl_week_number(current_playoff_week) AS current_nfl_week,
    ( SELECT count(*) AS count
           FROM public.users
          WHERE (users.paid = true)) AS paid_users,
    ( SELECT count(DISTINCT picks.user_id) AS count
           FROM public.picks
          WHERE (picks.week_number = public.get_nfl_week_number(gs.current_playoff_week))) AS users_with_picks
   FROM public.game_settings gs
 LIMIT 1;


--
-- Name: payout_structure id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_structure ALTER COLUMN id SET DEFAULT nextval('public.payout_structure_id_seq'::regclass);


--
-- Name: payouts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payouts ALTER COLUMN id SET DEFAULT nextval('public.payouts_id_seq'::regclass);


--
-- Name: pick_multipliers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pick_multipliers ALTER COLUMN id SET DEFAULT nextval('public.pick_multipliers_id_seq'::regclass);


--
-- Name: player_swaps id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_swaps ALTER COLUMN id SET DEFAULT nextval('public.player_swaps_id_seq'::regclass);


--
-- Name: position_requirements id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.position_requirements ALTER COLUMN id SET DEFAULT nextval('public.position_requirements_id_seq'::regclass);


--
-- Name: rules_content id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rules_content ALTER COLUMN id SET DEFAULT nextval('public.rules_content_id_seq'::regclass);


--
-- Name: scoring_rules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scoring_rules ALTER COLUMN id SET DEFAULT nextval('public.scoring_rules_id_seq'::regclass);


--
-- Name: signup_attempts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signup_attempts ALTER COLUMN id SET DEFAULT nextval('public.signup_attempts_id_seq'::regclass);


--
-- Name: admin_contest_audit admin_contest_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_contest_audit
    ADD CONSTRAINT admin_contest_audit_pkey PRIMARY KEY (id);


--
-- Name: api_contract_snapshots api_contract_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_contract_snapshots
    ADD CONSTRAINT api_contract_snapshots_pkey PRIMARY KEY (id);


--
-- Name: api_error_codes api_error_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_error_codes
    ADD CONSTRAINT api_error_codes_pkey PRIMARY KEY (code);


--
-- Name: contest_instances contest_instances_join_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contest_instances
    ADD CONSTRAINT contest_instances_join_token_key UNIQUE (join_token);


--
-- Name: contest_instances contest_instances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contest_instances
    ADD CONSTRAINT contest_instances_pkey PRIMARY KEY (id);


--
-- Name: contest_participants contest_participants_instance_user_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contest_participants
    ADD CONSTRAINT contest_participants_instance_user_unique UNIQUE (contest_instance_id, user_id);


--
-- Name: contest_participants contest_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contest_participants
    ADD CONSTRAINT contest_participants_pkey PRIMARY KEY (id);


--
-- Name: contest_templates contest_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contest_templates
    ADD CONSTRAINT contest_templates_pkey PRIMARY KEY (id);


--
-- Name: field_selections field_selections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_selections
    ADD CONSTRAINT field_selections_pkey PRIMARY KEY (id);


--
-- Name: game_settings game_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_settings
    ADD CONSTRAINT game_settings_pkey PRIMARY KEY (id);


--
-- Name: ingestion_events ingestion_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingestion_events
    ADD CONSTRAINT ingestion_events_pkey PRIMARY KEY (id);


--
-- Name: ingestion_validation_errors ingestion_validation_errors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingestion_validation_errors
    ADD CONSTRAINT ingestion_validation_errors_pkey PRIMARY KEY (id);


--
-- Name: ledger ledger_idempotency_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ledger
    ADD CONSTRAINT ledger_idempotency_key_unique UNIQUE (idempotency_key);


--
-- Name: ledger ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ledger
    ADD CONSTRAINT ledger_pkey PRIMARY KEY (id);


--
-- Name: payment_intents payment_intents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_intents
    ADD CONSTRAINT payment_intents_pkey PRIMARY KEY (id);


--
-- Name: payout_jobs payout_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_jobs
    ADD CONSTRAINT payout_jobs_pkey PRIMARY KEY (id);


--
-- Name: payout_jobs payout_jobs_settlement_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_jobs
    ADD CONSTRAINT payout_jobs_settlement_id_key UNIQUE (settlement_id);


--
-- Name: payout_requests payout_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_requests
    ADD CONSTRAINT payout_requests_pkey PRIMARY KEY (id);


--
-- Name: payout_structure payout_structure_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_structure
    ADD CONSTRAINT payout_structure_pkey PRIMARY KEY (id);


--
-- Name: payout_structure payout_structure_place_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_structure
    ADD CONSTRAINT payout_structure_place_key UNIQUE (place);


--
-- Name: payout_transfers payout_transfers_contest_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_transfers
    ADD CONSTRAINT payout_transfers_contest_id_user_id_key UNIQUE (contest_id, user_id);


--
-- Name: payout_transfers payout_transfers_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_transfers
    ADD CONSTRAINT payout_transfers_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: payout_transfers payout_transfers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_transfers
    ADD CONSTRAINT payout_transfers_pkey PRIMARY KEY (id);


--
-- Name: payouts payouts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payouts
    ADD CONSTRAINT payouts_pkey PRIMARY KEY (id);


--
-- Name: payouts payouts_place_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payouts
    ADD CONSTRAINT payouts_place_key UNIQUE (place);


--
-- Name: pick_multipliers pick_multipliers_pick_id_week_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pick_multipliers
    ADD CONSTRAINT pick_multipliers_pick_id_week_number_key UNIQUE (pick_id, week_number);


--
-- Name: pick_multipliers pick_multipliers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pick_multipliers
    ADD CONSTRAINT pick_multipliers_pkey PRIMARY KEY (id);


--
-- Name: picks picks_contest_user_player_week_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.picks
    ADD CONSTRAINT picks_contest_user_player_week_key UNIQUE (contest_instance_id, user_id, player_id, week_number);


--
-- Name: picks picks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.picks
    ADD CONSTRAINT picks_pkey PRIMARY KEY (id);


--
-- Name: player_swaps player_swaps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_swaps
    ADD CONSTRAINT player_swaps_pkey PRIMARY KEY (id);


--
-- Name: players players_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.players
    ADD CONSTRAINT players_pkey PRIMARY KEY (id);


--
-- Name: players players_sleeper_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.players
    ADD CONSTRAINT players_sleeper_id_unique UNIQUE (sleeper_id);


--
-- Name: position_requirements position_requirements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.position_requirements
    ADD CONSTRAINT position_requirements_pkey PRIMARY KEY (id);


--
-- Name: position_requirements position_requirements_position_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.position_requirements
    ADD CONSTRAINT position_requirements_position_key UNIQUE ("position");


--
-- Name: rules_content rules_content_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rules_content
    ADD CONSTRAINT rules_content_pkey PRIMARY KEY (id);


--
-- Name: rules_content rules_content_section_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rules_content
    ADD CONSTRAINT rules_content_section_key UNIQUE (section);


--
-- Name: score_history score_history_contest_instance_id_settlement_audit_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.score_history
    ADD CONSTRAINT score_history_contest_instance_id_settlement_audit_id_key UNIQUE (contest_instance_id, settlement_audit_id);


--
-- Name: score_history score_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.score_history
    ADD CONSTRAINT score_history_pkey PRIMARY KEY (id);


--
-- Name: scores scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scores
    ADD CONSTRAINT scores_pkey PRIMARY KEY (id);


--
-- Name: scoring_audit scoring_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scoring_audit
    ADD CONSTRAINT scoring_audit_pkey PRIMARY KEY (id);


--
-- Name: scoring_rules scoring_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scoring_rules
    ADD CONSTRAINT scoring_rules_pkey PRIMARY KEY (id);


--
-- Name: settlement_audit settlement_audit_contest_instance_id_settlement_run_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settlement_audit
    ADD CONSTRAINT settlement_audit_contest_instance_id_settlement_run_id_key UNIQUE (contest_instance_id, settlement_run_id);


--
-- Name: settlement_audit settlement_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settlement_audit
    ADD CONSTRAINT settlement_audit_pkey PRIMARY KEY (id);


--
-- Name: settlement_records settlement_records_one_per_contest; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settlement_records
    ADD CONSTRAINT settlement_records_one_per_contest UNIQUE (contest_instance_id);


--
-- Name: settlement_records settlement_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settlement_records
    ADD CONSTRAINT settlement_records_pkey PRIMARY KEY (id);


--
-- Name: signup_attempts signup_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signup_attempts
    ADD CONSTRAINT signup_attempts_pkey PRIMARY KEY (id);


--
-- Name: stripe_events stripe_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stripe_events
    ADD CONSTRAINT stripe_events_pkey PRIMARY KEY (id);


--
-- Name: stripe_webhook_dead_letters stripe_webhook_dead_letters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stripe_webhook_dead_letters
    ADD CONSTRAINT stripe_webhook_dead_letters_pkey PRIMARY KEY (id);


--
-- Name: tournament_config_versions tournament_config_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournament_config_versions
    ADD CONSTRAINT tournament_config_versions_pkey PRIMARY KEY (id);


--
-- Name: tournament_configs tournament_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournament_configs
    ADD CONSTRAINT tournament_configs_pkey PRIMARY KEY (id);


--
-- Name: ingestion_events unique_payload_per_contest; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingestion_events
    ADD CONSTRAINT unique_payload_per_contest UNIQUE (contest_instance_id, payload_hash);


--
-- Name: scores unique_user_player_week_score; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scores
    ADD CONSTRAINT unique_user_player_week_score UNIQUE (user_id, player_id, week_number);


--
-- Name: users users_apple_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_apple_id_key UNIQUE (apple_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: api_contract_snapshots_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX api_contract_snapshots_unique ON public.api_contract_snapshots USING btree (contract_name, version, sha256);


--
-- Name: idx_admin_contest_audit_admin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_contest_audit_admin ON public.admin_contest_audit USING btree (admin_user_id);


--
-- Name: idx_admin_contest_audit_contest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_contest_audit_contest ON public.admin_contest_audit USING btree (contest_instance_id);


--
-- Name: idx_admin_contest_audit_created_at_desc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_contest_audit_created_at_desc ON public.admin_contest_audit USING btree (created_at DESC);


--
-- Name: idx_admin_contest_audit_status_transition; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_contest_audit_status_transition ON public.admin_contest_audit USING btree (from_status, to_status);


--
-- Name: idx_contest_instances_is_platform_owned; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contest_instances_is_platform_owned ON public.contest_instances USING btree (is_platform_owned);


--
-- Name: idx_contest_instances_lock_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contest_instances_lock_at ON public.contest_instances USING btree (lock_at);


--
-- Name: idx_contest_instances_organizer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contest_instances_organizer ON public.contest_instances USING btree (organizer_id);


--
-- Name: idx_contest_instances_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contest_instances_status ON public.contest_instances USING btree (status);


--
-- Name: idx_contest_instances_template; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contest_instances_template ON public.contest_instances USING btree (template_id);


--
-- Name: idx_contest_participants_instance; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contest_participants_instance ON public.contest_participants USING btree (contest_instance_id);


--
-- Name: idx_contest_participants_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contest_participants_user ON public.contest_participants USING btree (user_id);


--
-- Name: idx_contest_templates_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contest_templates_active ON public.contest_templates USING btree (is_active);


--
-- Name: idx_contest_templates_sport; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contest_templates_sport ON public.contest_templates USING btree (sport);


--
-- Name: idx_contest_templates_template_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contest_templates_template_type ON public.contest_templates USING btree (template_type);


--
-- Name: idx_ingestion_events_contest_received; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ingestion_events_contest_received ON public.ingestion_events USING btree (contest_instance_id, received_at);


--
-- Name: idx_ingestion_events_payload_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ingestion_events_payload_hash ON public.ingestion_events USING btree (payload_hash);


--
-- Name: idx_ingestion_events_validation_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ingestion_events_validation_status ON public.ingestion_events USING btree (validation_status);


--
-- Name: idx_ingestion_validation_errors_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ingestion_validation_errors_code ON public.ingestion_validation_errors USING btree (error_code);


--
-- Name: idx_ingestion_validation_errors_contest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ingestion_validation_errors_contest ON public.ingestion_validation_errors USING btree (contest_instance_id, created_at);


--
-- Name: idx_ledger_contest_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ledger_contest_created ON public.ledger USING btree (contest_instance_id, created_at);


--
-- Name: idx_ledger_stripe_event_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ledger_stripe_event_id ON public.ledger USING btree (stripe_event_id);


--
-- Name: idx_ledger_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ledger_user_created ON public.ledger USING btree (user_id, created_at);


--
-- Name: idx_payment_intents_contest_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_intents_contest_user ON public.payment_intents USING btree (contest_instance_id, user_id);


--
-- Name: idx_payout_jobs_contest_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payout_jobs_contest_id ON public.payout_jobs USING btree (contest_id);


--
-- Name: idx_payout_requests_contest_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payout_requests_contest_user ON public.payout_requests USING btree (contest_instance_id, user_id);


--
-- Name: idx_payout_transfers_contest_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payout_transfers_contest_status ON public.payout_transfers USING btree (contest_id, status);


--
-- Name: idx_payout_transfers_job_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payout_transfers_job_id ON public.payout_transfers USING btree (payout_job_id);


--
-- Name: idx_payout_transfers_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payout_transfers_status ON public.payout_transfers USING btree (status);


--
-- Name: idx_pick_multipliers_pick_week; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pick_multipliers_pick_week ON public.pick_multipliers USING btree (pick_id, week_number);


--
-- Name: idx_picks_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_picks_user_id ON public.picks USING btree (user_id);


--
-- Name: idx_picks_user_week; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_picks_user_week ON public.picks USING btree (user_id, week_number);


--
-- Name: idx_picks_week; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_picks_week ON public.picks USING btree (week_number);


--
-- Name: idx_picks_week_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_picks_week_number ON public.picks USING btree (week_number);


--
-- Name: idx_picks_week_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_picks_week_user ON public.picks USING btree (week_number, user_id);


--
-- Name: idx_player_swaps_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_player_swaps_user_id ON public.player_swaps USING btree (user_id);


--
-- Name: idx_player_swaps_user_week; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_player_swaps_user_week ON public.player_swaps USING btree (user_id, week_number);


--
-- Name: idx_players_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_players_active ON public.players USING btree (is_active);


--
-- Name: idx_players_espn_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_players_espn_id ON public.players USING btree (espn_id);


--
-- Name: idx_players_position; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_players_position ON public.players USING btree ("position");


--
-- Name: idx_players_sleeper_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_players_sleeper_id ON public.players USING btree (sleeper_id);


--
-- Name: idx_players_team; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_players_team ON public.players USING btree (team);


--
-- Name: idx_score_history_contest_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_score_history_contest_created ON public.score_history USING btree (contest_instance_id, created_at);


--
-- Name: idx_scores_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scores_user_id ON public.scores USING btree (user_id);


--
-- Name: idx_scores_user_week; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scores_user_week ON public.scores USING btree (user_id, week_number);


--
-- Name: idx_scores_week; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scores_week ON public.scores USING btree (week_number);


--
-- Name: idx_scores_week_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scores_week_number ON public.scores USING btree (week_number);


--
-- Name: idx_scores_week_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scores_week_user ON public.scores USING btree (week_number, user_id);


--
-- Name: idx_scoring_rules_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scoring_rules_category ON public.scoring_rules USING btree (category);


--
-- Name: idx_scoring_rules_stat_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scoring_rules_stat_name ON public.scoring_rules USING btree (stat_name);


--
-- Name: idx_settlement_audit_contest_started; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_settlement_audit_contest_started ON public.settlement_audit USING btree (contest_instance_id, started_at);


--
-- Name: idx_settlement_audit_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_settlement_audit_status ON public.settlement_audit USING btree (status);


--
-- Name: idx_settlement_records_contest_instance; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_settlement_records_contest_instance ON public.settlement_records USING btree (contest_instance_id);


--
-- Name: idx_settlement_records_settled_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_settlement_records_settled_at ON public.settlement_records USING btree (settled_at DESC);


--
-- Name: idx_signup_attempts_apple_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_signup_attempts_apple_id ON public.signup_attempts USING btree (apple_id);


--
-- Name: idx_signup_attempts_attempted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_signup_attempts_attempted_at ON public.signup_attempts USING btree (attempted_at DESC);


--
-- Name: idx_signup_attempts_blocked; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_signup_attempts_blocked ON public.signup_attempts USING btree (blocked);


--
-- Name: idx_signup_attempts_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_signup_attempts_state ON public.signup_attempts USING btree (attempted_state);


--
-- Name: idx_users_eligibility; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_eligibility ON public.users USING btree (eligibility_confirmed_at);


--
-- Name: idx_users_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_state ON public.users USING btree (state);


--
-- Name: ledger_stripe_event_id_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ledger_stripe_event_id_uq ON public.ledger USING btree (stripe_event_id) WHERE (stripe_event_id IS NOT NULL);


--
-- Name: payment_intents_idempotency_key_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX payment_intents_idempotency_key_uq ON public.payment_intents USING btree (idempotency_key);


--
-- Name: payment_intents_stripe_pi_id_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX payment_intents_stripe_pi_id_uq ON public.payment_intents USING btree (stripe_payment_intent_id) WHERE (stripe_payment_intent_id IS NOT NULL);


--
-- Name: payout_requests_idempotency_key_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX payout_requests_idempotency_key_uq ON public.payout_requests USING btree (idempotency_key);


--
-- Name: stripe_events_stripe_event_id_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX stripe_events_stripe_event_id_uq ON public.stripe_events USING btree (stripe_event_id);


--
-- Name: stripe_webhook_dead_letters_event_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX stripe_webhook_dead_letters_event_id_idx ON public.stripe_webhook_dead_letters USING btree (stripe_event_id);


--
-- Name: uniq_active_config; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_active_config ON public.tournament_configs USING btree (contest_instance_id) WHERE (is_active = true);


--
-- Name: unique_espn_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX unique_espn_id ON public.players USING btree (espn_id);


--
-- Name: users_stripe_connected_account_id_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_stripe_connected_account_id_unique ON public.users USING btree (stripe_connected_account_id) WHERE (stripe_connected_account_id IS NOT NULL);


--
-- Name: api_contract_snapshots api_contract_snapshots_block_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER api_contract_snapshots_block_delete BEFORE DELETE ON public.api_contract_snapshots FOR EACH ROW EXECUTE FUNCTION public.api_contract_snapshots_no_update_delete();


--
-- Name: api_contract_snapshots api_contract_snapshots_block_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER api_contract_snapshots_block_update BEFORE UPDATE ON public.api_contract_snapshots FOR EACH ROW EXECUTE FUNCTION public.api_contract_snapshots_no_update_delete();


--
-- Name: api_error_codes api_error_codes_block_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER api_error_codes_block_delete BEFORE DELETE ON public.api_error_codes FOR EACH ROW EXECUTE FUNCTION public.api_error_codes_no_update_delete();


--
-- Name: api_error_codes api_error_codes_block_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER api_error_codes_block_update BEFORE UPDATE ON public.api_error_codes FOR EACH ROW EXECUTE FUNCTION public.api_error_codes_no_update_delete();


--
-- Name: ingestion_events ingestion_events_no_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER ingestion_events_no_update BEFORE DELETE OR UPDATE ON public.ingestion_events FOR EACH ROW EXECUTE FUNCTION public.prevent_updates_deletes();


--
-- Name: ingestion_validation_errors ingestion_validation_errors_no_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER ingestion_validation_errors_no_update BEFORE DELETE OR UPDATE ON public.ingestion_validation_errors FOR EACH ROW EXECUTE FUNCTION public.prevent_updates_deletes();


--
-- Name: ledger ledger_no_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER ledger_no_update BEFORE DELETE OR UPDATE ON public.ledger FOR EACH ROW EXECUTE FUNCTION public.prevent_updates_deletes();


--
-- Name: score_history score_history_no_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER score_history_no_update BEFORE DELETE OR UPDATE ON public.score_history FOR EACH ROW EXECUTE FUNCTION public.prevent_updates_deletes();


--
-- Name: settlement_audit settlement_audit_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER settlement_audit_guard BEFORE DELETE OR UPDATE ON public.settlement_audit FOR EACH ROW EXECUTE FUNCTION public.prevent_settlement_audit_illegal_update();


--
-- Name: stripe_events stripe_events_no_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stripe_events_no_update BEFORE DELETE OR UPDATE ON public.stripe_events FOR EACH ROW EXECUTE FUNCTION public.prevent_updates_deletes();


--
-- Name: payout_transfers trg_payout_transfers_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_payout_transfers_set_updated_at BEFORE UPDATE ON public.payout_transfers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: tournament_configs trg_prevent_config_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_prevent_config_update BEFORE UPDATE ON public.tournament_configs FOR EACH ROW EXECUTE FUNCTION public.prevent_config_update_when_locked();


--
-- Name: payout_structure update_payout_structure_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_payout_structure_updated_at BEFORE UPDATE ON public.payout_structure FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: pick_multipliers update_pick_multipliers_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_pick_multipliers_updated_at BEFORE UPDATE ON public.pick_multipliers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: position_requirements update_position_requirements_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_position_requirements_updated_at BEFORE UPDATE ON public.position_requirements FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: rules_content update_rules_content_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_rules_content_updated_at BEFORE UPDATE ON public.rules_content FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: scoring_rules update_scoring_rules_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_scoring_rules_updated_at BEFORE UPDATE ON public.scoring_rules FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: users update_users_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: admin_contest_audit admin_contest_audit_admin_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_contest_audit
    ADD CONSTRAINT admin_contest_audit_admin_user_id_fkey FOREIGN KEY (admin_user_id) REFERENCES public.users(id);


--
-- Name: admin_contest_audit admin_contest_audit_contest_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_contest_audit
    ADD CONSTRAINT admin_contest_audit_contest_fk FOREIGN KEY (contest_instance_id) REFERENCES public.contest_instances(id) ON DELETE RESTRICT;


--
-- Name: field_selections field_selections_contest_instance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_selections
    ADD CONSTRAINT field_selections_contest_instance_id_fkey FOREIGN KEY (contest_instance_id) REFERENCES public.contest_instances(id) ON DELETE CASCADE;


--
-- Name: field_selections field_selections_tournament_config_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_selections
    ADD CONSTRAINT field_selections_tournament_config_id_fkey FOREIGN KEY (tournament_config_id) REFERENCES public.tournament_configs(id) ON DELETE CASCADE;


--
-- Name: contest_instances fk_contest_instance_organizer; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contest_instances
    ADD CONSTRAINT fk_contest_instance_organizer FOREIGN KEY (organizer_id) REFERENCES public.users(id);


--
-- Name: contest_instances fk_contest_instance_template; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contest_instances
    ADD CONSTRAINT fk_contest_instance_template FOREIGN KEY (template_id) REFERENCES public.contest_templates(id);


--
-- Name: contest_participants fk_contest_participant_instance; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contest_participants
    ADD CONSTRAINT fk_contest_participant_instance FOREIGN KEY (contest_instance_id) REFERENCES public.contest_instances(id) ON DELETE CASCADE;


--
-- Name: contest_participants fk_contest_participant_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contest_participants
    ADD CONSTRAINT fk_contest_participant_user FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: ingestion_events ingestion_events_contest_instance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingestion_events
    ADD CONSTRAINT ingestion_events_contest_instance_id_fkey FOREIGN KEY (contest_instance_id) REFERENCES public.contest_instances(id) ON DELETE RESTRICT;


--
-- Name: ingestion_validation_errors ingestion_validation_errors_contest_instance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingestion_validation_errors
    ADD CONSTRAINT ingestion_validation_errors_contest_instance_id_fkey FOREIGN KEY (contest_instance_id) REFERENCES public.contest_instances(id) ON DELETE RESTRICT;


--
-- Name: ingestion_validation_errors ingestion_validation_errors_ingestion_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingestion_validation_errors
    ADD CONSTRAINT ingestion_validation_errors_ingestion_event_id_fkey FOREIGN KEY (ingestion_event_id) REFERENCES public.ingestion_events(id) ON DELETE RESTRICT;


--
-- Name: ledger ledger_contest_instance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ledger
    ADD CONSTRAINT ledger_contest_instance_id_fkey FOREIGN KEY (contest_instance_id) REFERENCES public.contest_instances(id) ON DELETE RESTRICT;


--
-- Name: ledger ledger_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ledger
    ADD CONSTRAINT ledger_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: payment_intents payment_intents_contest_instance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_intents
    ADD CONSTRAINT payment_intents_contest_instance_id_fkey FOREIGN KEY (contest_instance_id) REFERENCES public.contest_instances(id) ON DELETE RESTRICT;


--
-- Name: payment_intents payment_intents_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_intents
    ADD CONSTRAINT payment_intents_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: payout_jobs payout_jobs_contest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_jobs
    ADD CONSTRAINT payout_jobs_contest_id_fkey FOREIGN KEY (contest_id) REFERENCES public.contest_instances(id);


--
-- Name: payout_requests payout_requests_contest_instance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_requests
    ADD CONSTRAINT payout_requests_contest_instance_id_fkey FOREIGN KEY (contest_instance_id) REFERENCES public.contest_instances(id) ON DELETE RESTRICT;


--
-- Name: payout_requests payout_requests_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_requests
    ADD CONSTRAINT payout_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: payout_transfers payout_transfers_contest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_transfers
    ADD CONSTRAINT payout_transfers_contest_id_fkey FOREIGN KEY (contest_id) REFERENCES public.contest_instances(id);


--
-- Name: payout_transfers payout_transfers_payout_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_transfers
    ADD CONSTRAINT payout_transfers_payout_job_id_fkey FOREIGN KEY (payout_job_id) REFERENCES public.payout_jobs(id) ON DELETE CASCADE;


--
-- Name: payout_transfers payout_transfers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_transfers
    ADD CONSTRAINT payout_transfers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: pick_multipliers pick_multipliers_pick_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pick_multipliers
    ADD CONSTRAINT pick_multipliers_pick_id_fkey FOREIGN KEY (pick_id) REFERENCES public.picks(id) ON DELETE CASCADE;


--
-- Name: picks picks_contest_instance_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.picks
    ADD CONSTRAINT picks_contest_instance_fk FOREIGN KEY (contest_instance_id) REFERENCES public.contest_instances(id) ON DELETE CASCADE;


--
-- Name: picks picks_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.picks
    ADD CONSTRAINT picks_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id) ON DELETE CASCADE;


--
-- Name: picks picks_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.picks
    ADD CONSTRAINT picks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: player_swaps player_swaps_new_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_swaps
    ADD CONSTRAINT player_swaps_new_player_id_fkey FOREIGN KEY (new_player_id) REFERENCES public.players(id);


--
-- Name: player_swaps player_swaps_old_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_swaps
    ADD CONSTRAINT player_swaps_old_player_id_fkey FOREIGN KEY (old_player_id) REFERENCES public.players(id);


--
-- Name: player_swaps player_swaps_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_swaps
    ADD CONSTRAINT player_swaps_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: score_history score_history_contest_instance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.score_history
    ADD CONSTRAINT score_history_contest_instance_id_fkey FOREIGN KEY (contest_instance_id) REFERENCES public.contest_instances(id) ON DELETE RESTRICT;


--
-- Name: score_history score_history_settlement_audit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.score_history
    ADD CONSTRAINT score_history_settlement_audit_id_fkey FOREIGN KEY (settlement_audit_id) REFERENCES public.settlement_audit(id) ON DELETE RESTRICT;


--
-- Name: scores scores_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scores
    ADD CONSTRAINT scores_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id) ON DELETE CASCADE;


--
-- Name: scores scores_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scores
    ADD CONSTRAINT scores_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: scoring_audit scoring_audit_contest_instance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scoring_audit
    ADD CONSTRAINT scoring_audit_contest_instance_id_fkey FOREIGN KEY (contest_instance_id) REFERENCES public.contest_instances(id) ON DELETE CASCADE;


--
-- Name: scoring_audit scoring_audit_tournament_config_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scoring_audit
    ADD CONSTRAINT scoring_audit_tournament_config_id_fkey FOREIGN KEY (tournament_config_id) REFERENCES public.tournament_configs(id) ON DELETE CASCADE;


--
-- Name: settlement_audit settlement_audit_contest_instance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settlement_audit
    ADD CONSTRAINT settlement_audit_contest_instance_id_fkey FOREIGN KEY (contest_instance_id) REFERENCES public.contest_instances(id) ON DELETE RESTRICT;


--
-- Name: settlement_records settlement_records_contest_instance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settlement_records
    ADD CONSTRAINT settlement_records_contest_instance_id_fkey FOREIGN KEY (contest_instance_id) REFERENCES public.contest_instances(id) ON DELETE RESTRICT;


--
-- Name: tournament_config_versions tournament_config_versions_tournament_config_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournament_config_versions
    ADD CONSTRAINT tournament_config_versions_tournament_config_id_fkey FOREIGN KEY (tournament_config_id) REFERENCES public.tournament_configs(id) ON DELETE CASCADE;


--
-- Name: tournament_configs tournament_configs_contest_instance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournament_configs
    ADD CONSTRAINT tournament_configs_contest_instance_id_fkey FOREIGN KEY (contest_instance_id) REFERENCES public.contest_instances(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict 3mPVnFZgxSeXISdgqpnQgtJ2LW7aAN4XfRDoqppc48pdwLQdc0KFeCowlCSjbgF


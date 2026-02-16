--
-- PostgreSQL database dump
--

\restrict f2AJaJwbbfihELEeXTQf2X6u1EfidZdyrYKsZ7y1Ar8Ppof7iiSgiwxInlOvvwn

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

SET default_tablespace = '';

SET default_table_access_method = heap;

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
-- Data for Name: api_contract_snapshots; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.api_contract_snapshots (id, contract_name, version, sha256, spec_json, created_at) FROM stdin;
\.


--
-- Data for Name: api_error_codes; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.api_error_codes (code, http_status, scope, description, created_at) FROM stdin;
_APPEND_ONLY_TEST	400	internal	test row	2026-02-16 04:29:09.74516+00
STRIPE_SIGNATURE_MISSING	400	public	Missing Stripe-Signature header	2026-02-16 04:29:52.495234+00
STRIPE_SIGNATURE_INVALID	400	public	Stripe signature validation failed	2026-02-16 04:29:52.495234+00
STRIPE_EVENT_JSON_INVALID	400	public	Invalid JSON payload for webhook	2026-02-16 04:29:52.495234+00
STRIPE_EVENT_DUPLICATE	200	public	Duplicate Stripe event acknowledged (idempotent)	2026-02-16 04:29:52.495234+00
IDEMPOTENCY_KEY_MISSING	400	public	Idempotency key missing on state-mutating request	2026-02-16 04:29:52.495234+00
IDEMPOTENCY_KEY_INVALID	400	public	Idempotency key invalid	2026-02-16 04:29:52.495234+00
INTERNAL_DB_ERROR	500	internal	Database operation failed	2026-02-16 04:29:52.495234+00
INTERNAL_CONTRACT_MISMATCH	500	internal	Generated contract differs from frozen contract	2026-02-16 04:29:52.495234+00
\.


--
-- Data for Name: stripe_webhook_dead_letters; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.stripe_webhook_dead_letters (id, stripe_event_id, event_type, failure_class, error_json, created_at) FROM stdin;
\.


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
-- Name: stripe_webhook_dead_letters stripe_webhook_dead_letters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stripe_webhook_dead_letters
    ADD CONSTRAINT stripe_webhook_dead_letters_pkey PRIMARY KEY (id);


--
-- Name: api_contract_snapshots_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX api_contract_snapshots_unique ON public.api_contract_snapshots USING btree (contract_name, version, sha256);


--
-- Name: stripe_webhook_dead_letters_event_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX stripe_webhook_dead_letters_event_id_idx ON public.stripe_webhook_dead_letters USING btree (stripe_event_id);


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
-- PostgreSQL database dump complete
--

\unrestrict f2AJaJwbbfihELEeXTQf2X6u1EfidZdyrYKsZ7y1Ar8Ppof7iiSgiwxInlOvvwn


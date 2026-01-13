--
-- PostgreSQL database dump
--

\restrict 59lWZgkpeBfDkQH8KzABTB9SZNvHFIqhidePZH7K0SVVymr82P1Q0WZ3PD1hWBg

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
    is_week_active boolean DEFAULT true
);


--
-- Name: COLUMN game_settings.playoff_start_week; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.game_settings.playoff_start_week IS 'NFL week number where playoffs begin (19 = Wild Card for standard season)';


--
-- Name: COLUMN game_settings.current_playoff_week; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.game_settings.current_playoff_week IS 'Current active playoff week (0 = not started, 1-4 = rounds)';


--
-- Name: COLUMN game_settings.season_year; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.game_settings.season_year IS 'NFL season year (e.g. 2024)';


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
    is_bye_week boolean DEFAULT false
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
-- Name: TABLE signup_attempts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.signup_attempts IS 'Audit log of all signup attempts, including blocked ones for compliance reporting';


--
-- Name: COLUMN signup_attempts.apple_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.signup_attempts.apple_id IS 'Apple ID of user attempting signup';


--
-- Name: COLUMN signup_attempts.attempted_state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.signup_attempts.attempted_state IS 'State user selected during signup';


--
-- Name: COLUMN signup_attempts.ip_state_verified; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.signup_attempts.ip_state_verified IS 'State derived from IP geolocation';


--
-- Name: COLUMN signup_attempts.blocked; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.signup_attempts.blocked IS 'Whether signup was blocked';


--
-- Name: COLUMN signup_attempts.blocked_reason; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.signup_attempts.blocked_reason IS 'Reason for blocking (e.g., "Restricted state")';


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
    admin_notes text
);


--
-- Name: COLUMN users.state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.state IS 'User self-certified state of residence (2-letter code)';


--
-- Name: COLUMN users.ip_state_verified; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.ip_state_verified IS 'State derived from IP geolocation at signup (may differ from claimed state)';


--
-- Name: COLUMN users.state_certification_date; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.state_certification_date IS 'When user certified their state eligibility';


--
-- Name: COLUMN users.eligibility_confirmed_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.eligibility_confirmed_at IS 'When user confirmed age and eligibility requirements';


--
-- Name: COLUMN users.tos_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.tos_version IS 'Version of Terms of Service user agreed to (e.g., 2025-12-12)';


--
-- Name: COLUMN users.tos_accepted_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.tos_accepted_at IS 'When user accepted the Terms of Service';


--
-- Name: COLUMN users.age_verified; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.age_verified IS 'Whether user confirmed they are 18+ years old';


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
-- Data for Name: game_settings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.game_settings (id, entry_amount, venmo_handle, cashapp_handle, zelle_handle, game_mode, created_at, updated_at, qb_limit, rb_limit, wr_limit, te_limit, k_limit, def_limit, playoff_start_week, current_playoff_week, season_year, is_week_active) FROM stdin;
3c26a0d5-9401-43b8-b040-85724dff4e95	50	@chadrmcgee	$CRMcGee17	2144607348	traditional	2025-10-22 02:33:26	2026-01-05 16:22:09	1	2	3	1	1	1	19	1	2025	f
\.


--
-- Data for Name: payout_structure; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.payout_structure (id, place, percentage, description, is_active, created_at, updated_at) FROM stdin;
1	1	70.00	1st Place	t	2025-10-26 14:53:00.094933	2025-10-26 14:53:00.094933
2	2	20.00	2nd Place	t	2025-10-26 14:53:00.094933	2025-10-26 14:53:00.094933
3	3	10.00	3rd Place	t	2025-10-26 14:53:00.094933	2025-10-26 14:53:00.094933
\.


--
-- Data for Name: payouts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.payouts (id, place, percentage, description, created_at) FROM stdin;
1	1	50.00	First Place	2025-11-02 19:21:54.456024
2	2	30.00	Second Place	2025-11-02 19:21:54.456024
3	3	20.00	Third Place	2025-11-02 19:21:54.456024
\.


--
-- Data for Name: pick_multipliers; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.pick_multipliers (id, pick_id, week_number, consecutive_weeks, multiplier, is_bye_week, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: picks; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.picks (id, user_id, player_id, week_number, locked, created_at, "position", consecutive_weeks, multiplier, is_bye_week) FROM stdin;
3b62251d-380f-4dfd-a506-886ebd5dc3b7	8091de58-9e82-49e2-8712-beaa1486d9ff	8138	19	f	2026-01-06 00:29:47.712211	RB	1	1.0	f
dc57171a-95c0-44af-a5d2-3e0791528580	8091de58-9e82-49e2-8712-beaa1486d9ff	4866	19	f	2026-01-06 00:29:47.797914	RB	1	1.0	f
0764c95a-b602-4906-8d0a-3394e4ba341d	8091de58-9e82-49e2-8712-beaa1486d9ff	5022	19	f	2026-01-06 00:29:47.873915	TE	1	1.0	f
d9e24818-9acd-44c2-b74d-b717d761673a	8091de58-9e82-49e2-8712-beaa1486d9ff	5859	19	f	2026-01-06 00:29:47.942102	WR	1	1.0	f
19620a93-b05f-4299-ba96-34585bf0977c	8091de58-9e82-49e2-8712-beaa1486d9ff	9488	19	f	2026-01-06 00:29:48.035973	WR	1	1.0	f
0b920bbc-c705-4576-b16e-c3e42ab62779	8091de58-9e82-49e2-8712-beaa1486d9ff	9493	19	f	2026-01-06 00:29:48.113647	WR	1	1.0	f
dcf33a2e-d790-4b5f-a8fd-9b8abe6bb75c	8091de58-9e82-49e2-8712-beaa1486d9ff	PHI	19	f	2026-01-06 00:29:48.188823	DEF	1	1.0	f
f884e761-e741-44cb-9c74-26a4a65e1c6f	7bc28e3c-d2a2-4a70-b5a4-6d65eff6e757	8150	19	f	2026-01-10 02:57:36.609919	RB	1	1.0	f
8300a9a9-5c0d-427e-9ffc-cc42a0b14f7e	e89cb6a2-d04a-44a1-878e-3f70304f3383	HOU	19	f	2026-01-07 01:38:18.71077	DEF	1	1.0	f
ebefedec-bf44-4352-b1ad-83901dfb3218	e89cb6a2-d04a-44a1-878e-3f70304f3383	11563	19	f	2026-01-07 01:38:18.771629	QB	1	1.0	f
5feb3307-c34b-497c-8603-b202ab837b14	e89cb6a2-d04a-44a1-878e-3f70304f3383	7021	19	f	2026-01-07 01:38:18.836002	RB	1	1.0	f
e74127a9-29c4-4fb0-88a8-434d58d83769	e5274a58-b24c-45fb-ad7b-711af3d66ea7	4984	19	f	2026-01-10 03:21:40.32856	QB	0	1.0	f
b2c78d2c-a240-4c07-8f0f-b9f9d88c6e1d	c05554c7-c311-43c6-a070-40cb889e840a	5859	19	f	2026-01-10 04:19:07.158356	WR	0	1.0	f
04eb1fb7-6fce-4656-8865-abf25619661e	f99caf13-0faa-495d-b6d5-1366104cfb6c	2133	19	f	2026-01-10 03:58:25.221523	WR	0	1.0	f
edf0d97f-96cb-4a65-8c8a-d0ca76638c70	f99caf13-0faa-495d-b6d5-1366104cfb6c	JAX	19	f	2026-01-10 03:59:49.848012	DEF	0	1.0	f
4928bf22-bcfc-4409-a49a-f0bb82435ae1	c05554c7-c311-43c6-a070-40cb889e840a	6904	19	f	2026-01-10 04:18:35.138336	QB	0	1.0	f
a5026f12-915e-4324-acd5-6c2214840310	c05554c7-c311-43c6-a070-40cb889e840a	11635	19	f	2026-01-10 04:19:24.970477	WR	0	1.0	f
cb220536-b64d-480f-aaff-c5dfa1b3e927	c05554c7-c311-43c6-a070-40cb889e840a	5045	19	f	2026-01-10 04:20:58.356711	WR	0	1.0	f
6d78355b-8535-4d37-9f59-4ab60c46e423	c05554c7-c311-43c6-a070-40cb889e840a	5022	19	f	2026-01-10 04:21:15.193745	TE	0	1.0	f
3b3630b2-e7b1-42c1-8b2c-f53300c2c666	d24ad709-1f34-4a5c-94c0-c3be9b11c243	4217	19	f	2026-01-10 05:11:15.759122	TE	1	1.0	f
52b8e2ef-d9bb-48a8-9467-67d34c36901a	c05554c7-c311-43c6-a070-40cb889e840a	4195	19	f	2026-01-10 04:21:26.222209	K	0	1.0	f
2c62e27e-6112-4925-8d6a-fa5f6a942a2c	d24ad709-1f34-4a5c-94c0-c3be9b11c243	9488	19	f	2026-01-10 05:11:15.815997	WR	1	1.0	f
1dedcb17-5756-4439-80a0-785ef2960ed2	d24ad709-1f34-4a5c-94c0-c3be9b11c243	7523	19	f	2026-01-10 05:11:15.578422	QB	1	1.0	f
8c03de6b-8611-4a7c-b576-4e129f946a5c	c05554c7-c311-43c6-a070-40cb889e840a	GB	19	f	2026-01-10 04:21:44.147702	DEF	0	1.0	f
1526cc4a-23dd-45a2-a21a-53ff708d5b87	3d0e444e-55af-4dd6-bea8-f7959efca74c	8183	19	f	2026-01-06 02:47:27.396739	QB	1	1.0	f
6eb24142-9a70-45a4-a06a-aff6087af429	3d0e444e-55af-4dd6-bea8-f7959efca74c	4034	19	f	2026-01-06 02:47:27.586729	RB	1	1.0	f
a1c1ed0a-4f9f-4f6f-8e1f-7199c964a31a	78228a8f-0563-44b2-bee2-1db1699c6cd9	HOU	19	f	2026-01-07 19:06:15.671955	DEF	1	1.0	f
92ba2c29-35b1-4c7c-b9bc-b52a0f6a4db9	78228a8f-0563-44b2-bee2-1db1699c6cd9	17	19	f	2026-01-07 19:06:15.735415	K	1	1.0	f
57d9853d-896e-4a77-844b-01304fcff0a5	3d0e444e-55af-4dd6-bea8-f7959efca74c	5850	19	f	2026-01-06 02:47:27.659062	RB	1	1.0	f
a76fd98a-c2d9-49af-87c5-d836c19b7ee0	3d0e444e-55af-4dd6-bea8-f7959efca74c	9493	19	f	2026-01-06 02:47:27.72865	WR	1	1.0	f
cc6d2dbb-7cc2-41a0-ab37-7b52f6d3f557	3d0e444e-55af-4dd6-bea8-f7959efca74c	2449	19	f	2026-01-06 02:47:27.799597	WR	1	1.0	f
ef99f0b0-e384-4d34-9661-0e74d6dbe850	3d0e444e-55af-4dd6-bea8-f7959efca74c	9488	19	f	2026-01-06 02:47:27.87061	WR	1	1.0	f
c3a52456-c894-41fb-b664-eaa66a7943a4	3d0e444e-55af-4dd6-bea8-f7959efca74c	4217	19	f	2026-01-06 02:47:27.944683	TE	1	1.0	f
0ff93158-3cb2-4704-b683-87ef24ac0b61	3d0e444e-55af-4dd6-bea8-f7959efca74c	5189	19	f	2026-01-06 02:47:28.020869	K	1	1.0	f
1e0c56af-ffc2-413e-a86d-017b3e091f40	3d0e444e-55af-4dd6-bea8-f7959efca74c	SEA	19	f	2026-01-06 02:47:28.098779	DEF	1	1.0	f
bc428c78-f620-44cc-857c-fe549a1b6334	e89cb6a2-d04a-44a1-878e-3f70304f3383	6790	19	f	2026-01-07 01:38:18.904931	RB	1	1.0	f
def2a0dc-2559-4791-8624-7c156449595f	e89cb6a2-d04a-44a1-878e-3f70304f3383	7694	19	f	2026-01-07 01:38:18.96855	TE	1	1.0	f
3c8de59a-ff97-4459-bfa6-6cde6c4bbe28	78228a8f-0563-44b2-bee2-1db1699c6cd9	5850	19	f	2026-01-07 19:06:15.796577	RB	1	1.0	f
194c9469-773c-4352-a70d-9bf1ab88ce19	78228a8f-0563-44b2-bee2-1db1699c6cd9	8138	19	f	2026-01-07 19:06:15.865025	RB	1	1.0	f
6cd8d121-dea6-4075-8cdc-e90fd95e4e90	e89cb6a2-d04a-44a1-878e-3f70304f3383	8121	19	f	2026-01-07 01:38:19.024007	WR	1	1.0	f
e97a965d-a255-473d-8a42-7e2b67ef7b78	e89cb6a2-d04a-44a1-878e-3f70304f3383	11631	19	f	2026-01-07 01:38:19.088529	WR	1	1.0	f
7a931454-1bc9-475e-8f86-0cfc43d5c7e4	e89cb6a2-d04a-44a1-878e-3f70304f3383	4983	19	f	2026-01-07 01:38:19.159821	WR	1	1.0	f
82594ce8-59e0-4a55-816a-2c0d4d88f999	e89cb6a2-d04a-44a1-878e-3f70304f3383	3451	19	f	2026-01-07 01:38:19.2187	K	1	1.0	f
550b2bb6-2b3e-4bb1-a6e7-9991c1baecae	78228a8f-0563-44b2-bee2-1db1699c6cd9	4217	19	f	2026-01-07 19:06:15.92242	TE	1	1.0	f
80a4a96f-531c-4da3-8308-05af6a1b558a	8091de58-9e82-49e2-8712-beaa1486d9ff	4195	19	f	2026-01-06 00:29:47.565324	K	1	1.0	f
9fd0cf26-dc88-450a-90e6-895bba8e9538	d24ad709-1f34-4a5c-94c0-c3be9b11c243	9487	19	f	2026-01-10 05:11:15.869269	WR	1	1.0	f
d2ff7d89-97e9-4b02-931e-7e275b9960f8	78228a8f-0563-44b2-bee2-1db1699c6cd9	9488	19	f	2026-01-07 19:06:15.990229	WR	1	1.0	f
279c8f61-de4c-4b6a-aae9-7cfe88835db4	78228a8f-0563-44b2-bee2-1db1699c6cd9	7569	19	f	2026-01-07 19:06:16.05396	WR	1	1.0	f
c3472867-526d-4aed-b67f-b9cc3d760d3b	78228a8f-0563-44b2-bee2-1db1699c6cd9	9493	19	f	2026-01-07 19:06:16.118803	WR	1	1.0	f
afc196f1-c0e8-4473-92ad-9433830513a0	8091de58-9e82-49e2-8712-beaa1486d9ff	4984	19	f	2026-01-06 00:29:47.639283	QB	1	1.0	f
8f30a145-540f-4792-a669-b7f17c62566f	b1abaca0-b950-4f59-a54b-4d9bf54b9d0f	12489	19	f	2026-01-06 03:05:45.431197	RB	1	1.0	f
c233e897-13d4-4993-9483-ad0b9994f101	b1abaca0-b950-4f59-a54b-4d9bf54b9d0f	12526	19	f	2026-01-06 03:05:45.498165	WR	1	1.0	f
1e3738de-2fb2-476d-9e01-9c2c5c7cae19	b1abaca0-b950-4f59-a54b-4d9bf54b9d0f	8167	19	f	2026-01-06 03:05:45.564564	WR	1	1.0	f
e83292e5-f124-426f-8155-1c9e965837e5	b1abaca0-b950-4f59-a54b-4d9bf54b9d0f	9493	19	f	2026-01-06 03:05:45.631407	WR	1	1.0	f
2fad0f72-6d42-47bc-bb56-a5cbe1a11697	b1abaca0-b950-4f59-a54b-4d9bf54b9d0f	6804	19	f	2026-01-06 03:05:45.698795	QB	1	1.0	f
f0ba2744-4e33-4df3-95ff-6acd6200c0c4	b1abaca0-b950-4f59-a54b-4d9bf54b9d0f	4217	19	f	2026-01-06 03:05:45.765537	TE	1	1.0	f
8c9b721e-1356-4096-8ce1-a10caf9198ef	b1abaca0-b950-4f59-a54b-4d9bf54b9d0f	4034	19	f	2026-01-06 03:05:45.832305	RB	1	1.0	f
a7b855ae-f5f7-4af7-9bf2-1df970a714c4	b1abaca0-b950-4f59-a54b-4d9bf54b9d0f	12015	19	f	2026-01-06 03:05:45.897223	K	1	1.0	f
9949cbaf-bc5b-47a0-9fa2-7cd6693f7814	b1abaca0-b950-4f59-a54b-4d9bf54b9d0f	HOU	19	f	2026-01-06 03:05:45.967329	DEF	1	1.0	f
935b2a6b-81b3-4fbf-aff3-bac750e78639	d24ad709-1f34-4a5c-94c0-c3be9b11c243	4034	19	f	2026-01-10 05:11:15.700804	RB	1	1.0	f
f234cde8-ed46-44db-9be9-f1ae8ea77b46	d24ad709-1f34-4a5c-94c0-c3be9b11c243	12529	19	f	2026-01-10 05:11:15.639595	RB	1	1.0	f
a103a556-263a-47d4-bee9-0f9f990e84dd	d24ad709-1f34-4a5c-94c0-c3be9b11c243	7049	19	f	2026-01-10 05:11:15.926111	WR	1	1.0	f
ca91660a-c9d3-47e0-b53d-d7e0becd20a5	be53f692-990b-4ae6-b061-65753d22fb31	4034	19	f	2026-01-07 04:13:51.669272	RB	1	1.0	f
b8289376-dac4-42a9-b638-8157b5d4e73c	be53f692-990b-4ae6-b061-65753d22fb31	9493	19	f	2026-01-07 04:13:51.874441	WR	1	1.0	f
c15fde24-3fb3-4c97-8b4c-0c5670653012	be53f692-990b-4ae6-b061-65753d22fb31	2133	19	f	2026-01-07 04:13:51.982179	WR	1	1.0	f
eaf0e3ae-c169-46dd-b5ad-254f6e755d31	be53f692-990b-4ae6-b061-65753d22fb31	12713	19	f	2026-01-07 04:13:52.08436	K	1	1.0	f
8673f72c-4dc1-4223-9b30-96a03fa4b2b6	be53f692-990b-4ae6-b061-65753d22fb31	11564	19	f	2026-01-07 04:13:52.185988	QB	1	1.0	f
24eaeeb1-f907-464e-a3a1-e5525fe76693	be53f692-990b-4ae6-b061-65753d22fb31	12529	19	f	2026-01-07 04:13:52.288151	RB	1	1.0	f
7672c010-7e12-4329-9476-651433f4a3fe	be53f692-990b-4ae6-b061-65753d22fb31	2449	19	f	2026-01-07 04:13:52.386007	WR	1	1.0	f
79ee829d-f275-4e0a-89f2-81280287c2b6	be53f692-990b-4ae6-b061-65753d22fb31	NE	19	f	2026-01-07 04:13:52.504967	DEF	1	1.0	f
110e232c-51f5-4ae3-8964-cc9e2d4d5597	be53f692-990b-4ae6-b061-65753d22fb31	3214	19	f	2026-01-07 04:13:52.628808	TE	1	1.0	f
9da683f4-2be9-432a-8f94-0ff9b0293713	96894153-2d54-4b2e-9553-b9e866fd9db3	9493	19	f	2026-01-10 02:56:31.910804	WR	0	1.0	f
be3ead65-7bb2-4d82-9d6a-7b662116ce37	96894153-2d54-4b2e-9553-b9e866fd9db3	7042	19	f	2026-01-10 02:57:23.995751	K	0	1.0	f
22ba7c02-be9f-4027-a0b6-ae58b1b9aca5	7bc28e3c-d2a2-4a70-b5a4-6d65eff6e757	9493	19	f	2026-01-10 02:57:36.666092	WR	1	1.0	f
d6ad643d-6543-40db-a2a4-a4f25b37eb65	7bc28e3c-d2a2-4a70-b5a4-6d65eff6e757	2133	19	f	2026-01-10 02:57:36.728817	WR	1	1.0	f
f6a50298-3712-424d-b7fd-9ac38cdbdeb0	7bc28e3c-d2a2-4a70-b5a4-6d65eff6e757	2449	19	f	2026-01-10 02:57:36.790401	WR	1	1.0	f
a123928e-fc8e-4b0c-bb1b-0989da687783	78228a8f-0563-44b2-bee2-1db1699c6cd9	4984	19	f	2026-01-07 19:06:16.182271	QB	1	1.0	f
3e6595ee-e435-4599-8299-c582e11fd529	7bc28e3c-d2a2-4a70-b5a4-6d65eff6e757	3271	19	f	2026-01-10 02:57:36.855754	TE	1	1.0	f
80d6aa3a-fcf2-430b-86c7-ca9b0bb56b6c	7bc28e3c-d2a2-4a70-b5a4-6d65eff6e757	11564	19	f	2026-01-10 02:57:36.916063	QB	1	1.0	f
bfb55553-50da-459e-812d-5a3482d77312	7bc28e3c-d2a2-4a70-b5a4-6d65eff6e757	12529	19	f	2026-01-10 02:57:36.973706	RB	1	1.0	f
a88819d0-548e-472a-ba3c-19af55a49355	7bc28e3c-d2a2-4a70-b5a4-6d65eff6e757	12015	19	f	2026-01-10 02:57:37.03112	K	1	1.0	f
7663992a-89ef-40ea-9e37-47f4023042e6	7bc28e3c-d2a2-4a70-b5a4-6d65eff6e757	LAR	19	f	2026-01-10 02:57:37.091396	DEF	1	1.0	f
6b769573-e930-41a0-b222-ac2bf6cab193	e5274a58-b24c-45fb-ad7b-711af3d66ea7	9493	19	f	2026-01-10 03:23:08.924593	WR	0	1.0	f
266f42de-1738-45fe-9745-a96e175ba49e	b25714c1-8c53-4a27-9bb2-110b8f68d4c8	10236	19	f	2026-01-10 03:26:35.346314	TE	0	1.0	f
d0ee8037-1e50-4754-9d8e-bb469f0d50c7	f99caf13-0faa-495d-b6d5-1366104cfb6c	11586	19	f	2026-01-10 03:56:26.328157	RB	0	1.0	f
2e94ca61-6d04-4aa5-96ca-6071f915bac7	b25714c1-8c53-4a27-9bb2-110b8f68d4c8	LAR	19	f	2026-01-10 04:01:14.494234	DEF	0	1.0	f
ce266f61-bce4-453f-b133-b3b3915342bf	c05554c7-c311-43c6-a070-40cb889e840a	4866	19	f	2026-01-10 04:18:45.986487	RB	0	1.0	f
52c914a0-62dd-4ecc-b22d-eff6ea10e49d	c05554c7-c311-43c6-a070-40cb889e840a	8138	19	f	2026-01-10 04:18:54.217003	RB	0	1.0	f
c0022930-4e4e-46fe-a806-b094901e1a7d	c6d87896-425c-4b88-8660-d0f0e532bdae	JAX	19	f	2026-01-10 14:47:35.542546	DEF	1	1.0	f
bc40335c-0b2f-4d32-9343-c533d8e8ed83	c6d87896-425c-4b88-8660-d0f0e532bdae	11786	19	f	2026-01-10 14:47:35.608753	K	1	1.0	f
39520482-e938-4c56-baa3-e38e92db1cf0	c6d87896-425c-4b88-8660-d0f0e532bdae	7523	19	f	2026-01-10 14:47:35.680589	QB	1	1.0	f
878d052c-b732-4dd9-a668-620386b46972	c6d87896-425c-4b88-8660-d0f0e532bdae	7543	19	f	2026-01-10 14:47:35.751136	RB	1	1.0	f
0ab719f1-8911-40ec-ace1-bde83984f291	c6d87896-425c-4b88-8660-d0f0e532bdae	9480	19	f	2026-01-10 14:47:35.820224	TE	1	1.0	f
6e9fda0e-9e2c-443b-88d8-6d18f32dd329	c6d87896-425c-4b88-8660-d0f0e532bdae	9488	19	f	2026-01-10 14:47:35.890555	WR	1	1.0	f
294d7ce2-5f99-4d4b-8309-549b188dc4c7	c6d87896-425c-4b88-8660-d0f0e532bdae	9487	19	f	2026-01-10 14:47:35.971122	WR	1	1.0	f
33d4aa6c-e57f-4795-a294-39189aa5cb22	c6d87896-425c-4b88-8660-d0f0e532bdae	9493	19	f	2026-01-10 14:47:36.038731	WR	1	1.0	f
25555446-44c1-4bd6-86ea-016aa9b343fc	0477bff2-c2e4-45e2-a00b-225df2154d96	HOU	19	f	2026-01-08 03:08:06.467654	DEF	1	1.0	f
927e6270-4dc4-44e5-9d4f-4c2ff71373f5	0477bff2-c2e4-45e2-a00b-225df2154d96	2747	19	f	2026-01-08 03:08:06.551348	K	1	1.0	f
9dddbf70-3f9b-4d21-a40c-a86c60acae58	0477bff2-c2e4-45e2-a00b-225df2154d96	421	19	f	2026-01-08 03:08:06.620148	QB	1	1.0	f
86326ec9-333f-48ff-a277-36c5b299385f	0477bff2-c2e4-45e2-a00b-225df2154d96	8138	19	f	2026-01-08 03:08:06.695749	RB	1	1.0	f
73e64def-1b1b-4d37-bb65-d32eac993846	0477bff2-c2e4-45e2-a00b-225df2154d96	4034	19	f	2026-01-08 03:08:06.773934	RB	1	1.0	f
b7bd6728-5938-42f6-9342-880b1d1fa334	e3692b76-bcc0-429b-ae4c-cc41b4802cd8	11564	19	f	2026-01-08 02:35:57.5749	QB	1	1.0	f
c47ea3a8-44c4-41fd-b85e-533828f7eb78	e3692b76-bcc0-429b-ae4c-cc41b4802cd8	12529	19	f	2026-01-08 02:35:57.629766	RB	1	1.0	f
36b6e5fa-53e2-467a-a2b9-c85cb20101b2	e3692b76-bcc0-429b-ae4c-cc41b4802cd8	2449	19	f	2026-01-08 02:35:57.685649	WR	1	1.0	f
fb2799ba-cac9-4115-bc7d-7705d43fc1cb	e3692b76-bcc0-429b-ae4c-cc41b4802cd8	4217	19	f	2026-01-08 02:35:57.74477	TE	1	1.0	f
ba423d6c-32c1-4e2b-a6c4-b20ab0294116	e3692b76-bcc0-429b-ae4c-cc41b4802cd8	12713	19	f	2026-01-08 02:35:57.791007	K	1	1.0	f
133930bc-8bcf-470e-804a-f8b03bf149aa	e3692b76-bcc0-429b-ae4c-cc41b4802cd8	NE	19	f	2026-01-08 02:35:57.837642	DEF	1	1.0	f
4d4fcddc-fa13-425b-a0ed-6716a698d268	e3692b76-bcc0-429b-ae4c-cc41b4802cd8	4034	19	f	2026-01-08 02:35:57.897982	RB	1	1.0	f
7f951bd3-0729-42c1-9919-424a382f7229	e3692b76-bcc0-429b-ae4c-cc41b4802cd8	7049	19	f	2026-01-08 02:35:57.949098	WR	1	1.0	f
53673ca3-d746-4494-a0ba-31b65abe9867	e3692b76-bcc0-429b-ae4c-cc41b4802cd8	11638	19	f	2026-01-08 02:35:57.995792	WR	1	1.0	f
447b5e71-2534-41ef-925f-7e529f525797	0477bff2-c2e4-45e2-a00b-225df2154d96	9493	19	f	2026-01-08 03:08:06.856032	WR	1	1.0	f
d465e088-c187-463c-a970-1f676b930e33	0477bff2-c2e4-45e2-a00b-225df2154d96	9480	19	f	2026-01-08 03:08:06.9989	TE	1	1.0	f
36aa838f-b5d5-401a-bd3d-de55547e2926	0477bff2-c2e4-45e2-a00b-225df2154d96	9488	19	f	2026-01-08 03:08:07.071807	WR	1	1.0	f
10cca467-ee30-48f0-b6f6-ef4b33c764f7	b9318729-2286-465c-b0ae-f2a150d71ad2	8138	19	f	2026-01-08 11:44:48.472609	RB	1	1.0	f
6a40233d-e4d7-4a56-92ae-3068c25c6d38	b9318729-2286-465c-b0ae-f2a150d71ad2	2449	19	f	2026-01-08 11:44:48.588633	WR	1	1.0	f
c20de91f-1a58-4b28-b200-3c012a242b10	b9318729-2286-465c-b0ae-f2a150d71ad2	9493	19	f	2026-01-08 11:44:48.70541	WR	1	1.0	f
81ccbac5-c192-459d-9063-35e14b8ac9fb	b9318729-2286-465c-b0ae-f2a150d71ad2	NE	19	f	2026-01-08 11:44:47.981775	DEF	1	1.0	f
b636aab8-9e9b-4801-a031-3126e6c6e517	b9318729-2286-465c-b0ae-f2a150d71ad2	4195	19	f	2026-01-08 11:44:48.100483	K	1	1.0	f
28d90ecb-9d7b-4c1a-907f-148a67f4bab0	b9318729-2286-465c-b0ae-f2a150d71ad2	4984	19	f	2026-01-08 11:44:48.204417	QB	1	1.0	f
6f40182e-454e-4ab9-b443-17e609e5e29b	b9318729-2286-465c-b0ae-f2a150d71ad2	4866	19	f	2026-01-08 11:44:48.328298	RB	1	1.0	f
034786c0-37da-4db9-8194-3af30f689033	b9318729-2286-465c-b0ae-f2a150d71ad2	5859	19	f	2026-01-08 11:44:48.799926	WR	1	1.0	f
1e8c8f1f-e057-444a-82be-662ba8c4cb7d	b9318729-2286-465c-b0ae-f2a150d71ad2	3214	19	f	2026-01-08 11:44:48.908793	TE	1	1.0	f
a2974cd0-17f3-406b-8091-9b89c3738144	b25714c1-8c53-4a27-9bb2-110b8f68d4c8	12015	19	f	2026-01-08 19:27:50.153649	K	1	1.0	f
fe8ec163-8274-4cf6-af9f-dc6e063aac8a	b25714c1-8c53-4a27-9bb2-110b8f68d4c8	4984	19	f	2026-01-08 19:27:50.270148	QB	1	1.0	f
f614790c-b8e3-4c8a-9961-56e4bf25fd36	b25714c1-8c53-4a27-9bb2-110b8f68d4c8	8138	19	f	2026-01-08 19:27:50.392614	RB	1	1.0	f
543570a1-a61f-4d3a-93f9-a3d094d4d514	b25714c1-8c53-4a27-9bb2-110b8f68d4c8	8150	19	f	2026-01-08 19:27:50.629462	RB	1	1.0	f
b2885ca3-d101-417a-8ed3-1fd067d5a020	b25714c1-8c53-4a27-9bb2-110b8f68d4c8	2133	19	f	2026-01-08 19:27:50.895243	WR	1	1.0	f
a618f48c-11b4-42b8-9c60-9d9e4a332b42	b25714c1-8c53-4a27-9bb2-110b8f68d4c8	9493	19	f	2026-01-08 19:27:51.02029	WR	1	1.0	f
19533762-2ed1-4926-8024-5492d8ff38c3	b25714c1-8c53-4a27-9bb2-110b8f68d4c8	5859	19	f	2026-01-08 19:27:51.143256	WR	1	1.0	f
30a6af7f-ecc2-42d0-85f0-7a39f7f13112	c5abc1fc-2f96-40f7-82e6-9811a63ed7b5	11564	19	f	2026-01-08 22:43:56.646443	QB	1	1.0	f
615d2d2b-2fca-4b77-904f-1a2476669ba1	c5abc1fc-2f96-40f7-82e6-9811a63ed7b5	4866	19	f	2026-01-08 22:43:56.707528	RB	1	1.0	f
e9d81e7b-2df9-422d-8f00-67897aa1a207	c5abc1fc-2f96-40f7-82e6-9811a63ed7b5	8150	19	f	2026-01-08 22:43:56.765556	RB	1	1.0	f
b2877d95-95d1-4169-becc-6d09aca4d22a	c5abc1fc-2f96-40f7-82e6-9811a63ed7b5	9493	19	f	2026-01-08 22:43:56.826152	WR	1	1.0	f
1287790d-f7e9-4089-b140-d918f65f98f8	c5abc1fc-2f96-40f7-82e6-9811a63ed7b5	9488	19	f	2026-01-08 22:43:56.88739	WR	1	1.0	f
2cc55c75-743d-4277-811c-1726df90d62e	c5abc1fc-2f96-40f7-82e6-9811a63ed7b5	2449	19	f	2026-01-08 22:43:56.947734	WR	1	1.0	f
4055fc75-e7a2-4337-a022-22aa6fcf04ef	4477133e-bd55-4596-99da-8e1d6599e923	7523	19	f	2026-01-10 02:18:49.263299	QB	1	1.0	f
08d4c07d-123f-40f7-a28a-3ec2e4e08cae	4477133e-bd55-4596-99da-8e1d6599e923	4217	19	f	2026-01-10 02:18:49.449233	TE	1	1.0	f
b15663e4-7fe1-4a11-860d-68fd6104a49f	4477133e-bd55-4596-99da-8e1d6599e923	7569	19	f	2026-01-10 02:18:49.51487	WR	1	1.0	f
c347afcc-1774-47ac-b2cf-83e60ebb04b4	4477133e-bd55-4596-99da-8e1d6599e923	3451	19	f	2026-01-10 02:18:49.199636	K	1	1.0	f
4e06d433-cb20-44bb-a21b-a4c3774c7ac4	4477133e-bd55-4596-99da-8e1d6599e923	8150	19	f	2026-01-10 02:18:49.333015	RB	1	1.0	f
a0e3226c-8cfc-45f1-a9db-1c02109bbd95	4477133e-bd55-4596-99da-8e1d6599e923	4866	19	f	2026-01-10 02:18:49.388957	RB	1	1.0	f
7b9522ad-34df-49a4-8b5a-b35459545181	4477133e-bd55-4596-99da-8e1d6599e923	9487	19	f	2026-01-10 02:18:49.62701	WR	1	1.0	f
836058d2-2b10-4856-ab3a-d7544c271281	c5abc1fc-2f96-40f7-82e6-9811a63ed7b5	9480	19	f	2026-01-08 22:43:57.018639	TE	1	1.0	f
851c7b5f-d9f9-47dc-88da-e45263207ae0	c5abc1fc-2f96-40f7-82e6-9811a63ed7b5	2747	19	f	2026-01-08 22:43:57.072276	K	1	1.0	f
ee387f6a-3288-43f1-b4e6-7facf4977bd5	c5abc1fc-2f96-40f7-82e6-9811a63ed7b5	PHI	19	f	2026-01-08 22:43:57.131248	DEF	1	1.0	f
f8ea771b-4c4d-43bc-99e9-8c5fe0a33096	cf84e9bf-0c2c-4237-9768-9828ea922861	11564	19	f	2026-01-09 08:55:48.879842	QB	0	1.0	f
b372da06-ce32-4c29-89d9-750a79432779	cf84e9bf-0c2c-4237-9768-9828ea922861	4034	19	f	2026-01-09 08:56:26.314831	RB	0	1.0	f
98d7eeb7-9f00-42d1-be8b-066f669a7bca	cf84e9bf-0c2c-4237-9768-9828ea922861	4866	19	f	2026-01-09 08:56:48.038396	RB	0	1.0	f
ad26fc0d-701b-41e1-8539-6b6bc0bfc295	cf84e9bf-0c2c-4237-9768-9828ea922861	9493	19	f	2026-01-09 08:57:10.465473	WR	0	1.0	f
f60e2ddd-717e-406d-aa56-452e7a12431f	cf84e9bf-0c2c-4237-9768-9828ea922861	7569	19	f	2026-01-09 08:58:33.620091	WR	0	1.0	f
4c798d2f-a18f-49a4-b9e2-ffbc38b0ceed	cf84e9bf-0c2c-4237-9768-9828ea922861	12526	19	f	2026-01-09 08:59:15.937553	WR	0	1.0	f
49916cca-562b-4add-a51f-889bedba8614	96894153-2d54-4b2e-9553-b9e866fd9db3	8134	19	f	2026-01-10 02:56:47.274884	WR	0	1.0	f
a9ed693d-ba19-4a45-9820-cd1f78de6b79	cf84e9bf-0c2c-4237-9768-9828ea922861	3451	19	f	2026-01-09 09:00:25.305998	K	0	1.0	f
910b65cc-8385-483b-be35-9e8c2c365702	cf84e9bf-0c2c-4237-9768-9828ea922861	LAR	19	f	2026-01-09 09:00:49.917074	DEF	0	1.0	f
6f2c209a-1a6d-48a3-b8d2-2332bb18e5e8	cf84e9bf-0c2c-4237-9768-9828ea922861	9480	19	f	2026-01-09 09:58:29.824054	TE	0	1.0	f
d04b48d0-bd71-4c36-bb6b-43e46c441cb6	96894153-2d54-4b2e-9553-b9e866fd9db3	LAR	19	f	2026-01-10 02:57:55.635576	DEF	0	1.0	f
21f7e821-4ca0-4a39-a529-692857b7944c	f6cb1bd2-d8db-4b9c-92e5-5dcfbb70bced	4984	19	f	2026-01-09 15:16:55.046277	QB	1	1.0	f
dcf15776-4c1b-4f92-8b5c-efb9577991d4	f6cb1bd2-d8db-4b9c-92e5-5dcfbb70bced	12529	19	f	2026-01-09 15:16:55.136062	RB	1	1.0	f
d007d8ac-05aa-43c9-aeba-069c277313f2	f6cb1bd2-d8db-4b9c-92e5-5dcfbb70bced	4034	19	f	2026-01-09 15:16:55.231173	RB	1	1.0	f
e06100d1-4d71-48ac-a978-e936609b79c9	f6cb1bd2-d8db-4b9c-92e5-5dcfbb70bced	9488	19	f	2026-01-09 15:16:55.324473	WR	1	1.0	f
5781da70-889f-41c0-83b9-9f2d489fb62a	f6cb1bd2-d8db-4b9c-92e5-5dcfbb70bced	9487	19	f	2026-01-09 15:16:55.417994	WR	1	1.0	f
22f2f532-a793-4544-a2d9-1444313e2982	f6cb1bd2-d8db-4b9c-92e5-5dcfbb70bced	9493	19	f	2026-01-09 15:16:55.518835	WR	1	1.0	f
fc2d06e5-ecb7-473d-9715-3739d7666e73	f6cb1bd2-d8db-4b9c-92e5-5dcfbb70bced	4217	19	f	2026-01-09 15:16:55.608778	TE	1	1.0	f
69c79c52-649b-4adf-a9ea-ff4950c064ef	f6cb1bd2-d8db-4b9c-92e5-5dcfbb70bced	8259	19	f	2026-01-09 15:16:55.713542	K	1	1.0	f
dd4f01a5-0cf7-4cc7-98a2-0e5182622fe7	f6cb1bd2-d8db-4b9c-92e5-5dcfbb70bced	HOU	19	f	2026-01-09 15:16:55.811317	DEF	1	1.0	f
726247a9-62f4-49d0-a0f4-81e51a29d8a0	a08d1c9e-6070-4f64-a674-0a56a35ec792	421	19	f	2026-01-09 19:14:30.446848	QB	1	1.0	f
39f4ce05-c034-4c18-8bfe-de04a5673748	a08d1c9e-6070-4f64-a674-0a56a35ec792	9493	19	f	2026-01-09 19:14:30.608207	WR	1	1.0	f
ee1e7252-5dba-4124-92c8-b4b7ff40632a	a08d1c9e-6070-4f64-a674-0a56a35ec792	12713	19	f	2026-01-09 19:14:30.819985	K	1	1.0	f
293b81b7-5ef5-43e2-b675-6b2399515a58	a08d1c9e-6070-4f64-a674-0a56a35ec792	2449	19	f	2026-01-09 19:14:30.929788	WR	1	1.0	f
36aa5acd-4aef-46d8-a3cf-c0993d4e92f3	a08d1c9e-6070-4f64-a674-0a56a35ec792	8150	19	f	2026-01-09 19:14:31.044285	RB	1	1.0	f
e83a1010-0794-41dd-988d-5a2f4a7cdfe0	a08d1c9e-6070-4f64-a674-0a56a35ec792	12529	19	f	2026-01-09 19:14:31.149751	RB	1	1.0	f
b0dc96b6-b0fc-46c4-8ba7-bfae2592ebd7	a08d1c9e-6070-4f64-a674-0a56a35ec792	3271	19	f	2026-01-09 19:14:31.264885	TE	1	1.0	f
952b0044-01b3-4ff7-9dc1-755645770cc6	a08d1c9e-6070-4f64-a674-0a56a35ec792	9488	19	f	2026-01-09 19:14:31.381089	WR	1	1.0	f
cc0fa426-bc85-4d18-a0e5-d000c06fddd5	9fb7076d-153c-4a44-806e-2b4aef1f57f9	11563	19	f	2026-01-09 20:21:06.966451	QB	0	1.0	f
f678153d-d909-4eb7-8f92-ab8786df92ce	9fb7076d-153c-4a44-806e-2b4aef1f57f9	12489	19	f	2026-01-09 20:22:18.40258	RB	0	1.0	f
0615aff9-1aa9-4922-8be1-a9c4faf1d4b5	9fb7076d-153c-4a44-806e-2b4aef1f57f9	8151	19	f	2026-01-09 20:23:37.096986	RB	0	1.0	f
77e9dc30-0e06-4d70-a72c-f9211ec08c9a	9fb7076d-153c-4a44-806e-2b4aef1f57f9	5045	19	f	2026-01-09 20:24:04.428879	WR	0	1.0	f
4bb86983-d3e4-4747-8bf1-9c475f6029bb	9fb7076d-153c-4a44-806e-2b4aef1f57f9	8676	19	f	2026-01-09 20:24:32.742467	WR	0	1.0	f
6fe51d10-7eaa-49b1-a986-b62cb4f666c5	9fb7076d-153c-4a44-806e-2b4aef1f57f9	9488	19	f	2026-01-09 20:24:53.194201	WR	0	1.0	f
b4bf31a6-427e-40b6-809d-9f3a53b54432	9fb7076d-153c-4a44-806e-2b4aef1f57f9	6869	19	f	2026-01-09 20:26:04.116923	TE	0	1.0	f
899e1a1f-43f4-48ea-9865-caa104823418	9fb7076d-153c-4a44-806e-2b4aef1f57f9	3678	19	f	2026-01-09 20:26:23.368903	K	0	1.0	f
b61dfcb4-2b53-4a93-87df-a14bbaf60886	9fb7076d-153c-4a44-806e-2b4aef1f57f9	DEN	19	f	2026-01-09 20:26:36.57253	DEF	0	1.0	f
6f4be52b-6988-4dcf-b71d-04725d9170b2	f1f4ea45-5e97-4f49-8e3a-69f307c30f16	4984	19	f	2026-01-10 02:08:28.573516	QB	1	1.0	f
654e6783-79c8-41f4-9938-c404744b2ece	f1f4ea45-5e97-4f49-8e3a-69f307c30f16	4034	19	f	2026-01-10 02:08:28.653024	RB	1	1.0	f
f151c4ca-b30d-4708-8aa0-7dedfa53319f	f1f4ea45-5e97-4f49-8e3a-69f307c30f16	9493	19	f	2026-01-10 02:08:28.809973	WR	1	1.0	f
2af75ac4-cea3-4d9f-9236-0bddad1f2c70	f1f4ea45-5e97-4f49-8e3a-69f307c30f16	5859	19	f	2026-01-10 02:08:28.89663	WR	1	1.0	f
3b4734c0-f2a2-47a6-9471-30e16a34995b	f1f4ea45-5e97-4f49-8e3a-69f307c30f16	HOU	19	f	2026-01-10 02:08:29.120837	DEF	1	1.0	f
9d151988-23f3-4c48-baed-491b6831bad1	f1f4ea45-5e97-4f49-8e3a-69f307c30f16	7543	19	f	2026-01-10 02:08:29.200463	RB	1	1.0	f
9f14af4e-709b-4b7d-9525-0a8f5f39789c	4477133e-bd55-4596-99da-8e1d6599e923	9493	19	f	2026-01-10 02:18:49.572434	WR	1	1.0	f
a166c220-1b2e-42bf-ab6f-f993490ba08e	4477133e-bd55-4596-99da-8e1d6599e923	LAR	19	f	2026-01-10 02:18:49.681155	DEF	1	1.0	f
d4c640d3-e31b-40f7-80af-83e7eec160c7	e5274a58-b24c-45fb-ad7b-711af3d66ea7	8138	19	f	2026-01-10 03:22:38.735365	RB	0	1.0	f
23e7de53-b01a-4cb4-9363-be144ccfa88f	96894153-2d54-4b2e-9553-b9e866fd9db3	4984	19	f	2026-01-10 02:54:42.08853	QB	0	1.0	f
bf809f43-db8a-4558-924b-e60ad650a9d2	96894153-2d54-4b2e-9553-b9e866fd9db3	8138	19	f	2026-01-10 02:54:48.661139	RB	0	1.0	f
079d6455-1c37-4e2a-9085-d4d60ac1686e	e5274a58-b24c-45fb-ad7b-711af3d66ea7	3202	19	f	2026-01-10 03:23:31.915112	TE	0	1.0	f
834d16bd-74b4-44e7-a06e-6c56fafd902e	e5274a58-b24c-45fb-ad7b-711af3d66ea7	7042	19	f	2026-01-10 03:23:38.491845	K	0	1.0	f
505f74ce-d14a-4db0-9896-60af38547ee3	5f31df4f-f1be-4f82-a75e-006323f102d3	4984	19	f	2026-01-10 03:39:21.772357	QB	1	1.0	f
8ef26c6e-09f0-4109-ab05-7f25017c7e6a	5f31df4f-f1be-4f82-a75e-006323f102d3	8138	19	f	2026-01-10 03:39:21.834988	RB	1	1.0	f
a9128adb-6e31-4272-9c0a-2bc6cf2bc1d7	5f31df4f-f1be-4f82-a75e-006323f102d3	8150	19	f	2026-01-10 03:39:21.898445	RB	1	1.0	f
8d2c60a5-b22d-4695-9206-80d5a5270e0c	5f31df4f-f1be-4f82-a75e-006323f102d3	9493	19	f	2026-01-10 03:39:21.975424	WR	1	1.0	f
894175c9-e261-4f77-88d0-dd5689d9ab87	5f31df4f-f1be-4f82-a75e-006323f102d3	5045	19	f	2026-01-10 03:39:22.047662	WR	1	1.0	f
21b74357-7b67-46be-9cf7-c1c3dccc888c	5f31df4f-f1be-4f82-a75e-006323f102d3	2449	19	f	2026-01-10 03:39:22.131362	WR	1	1.0	f
d7a1a882-90e1-4038-85c7-4b16afc2d6ee	5f31df4f-f1be-4f82-a75e-006323f102d3	4217	19	f	2026-01-10 03:39:22.197688	TE	1	1.0	f
08d9366d-fcee-43ff-84fe-2f6e920c65fd	5f31df4f-f1be-4f82-a75e-006323f102d3	17	19	f	2026-01-10 03:39:22.271969	K	1	1.0	f
2c1b0846-00e5-49a6-84a7-a3d8b401e1f7	5f31df4f-f1be-4f82-a75e-006323f102d3	LAR	19	f	2026-01-10 03:39:22.346234	DEF	1	1.0	f
e94a10cd-10cf-4ffb-9286-5598b77fa3c9	f99caf13-0faa-495d-b6d5-1366104cfb6c	7523	19	f	2026-01-10 03:55:08.619041	QB	0	1.0	f
d495fcd3-b6c3-4ac3-8471-32e93cd558bb	f99caf13-0faa-495d-b6d5-1366104cfb6c	7543	19	f	2026-01-10 03:55:17.989503	RB	0	1.0	f
cb8098c1-d0f0-42f8-b8c5-f29b30e04cf9	f99caf13-0faa-495d-b6d5-1366104cfb6c	11631	19	f	2026-01-10 03:56:45.92927	WR	0	1.0	f
3cd3624e-d13c-4881-904a-9f761c4a1cda	f99caf13-0faa-495d-b6d5-1366104cfb6c	9493	19	f	2026-01-10 03:56:54.794962	WR	0	1.0	f
ad047d93-ac69-4a2e-a6ff-a7a99528b8bc	f99caf13-0faa-495d-b6d5-1366104cfb6c	10214	19	f	2026-01-10 03:59:08.899029	TE	0	1.0	f
86d01aa4-4561-4484-bae8-28c1eb960dbc	f99caf13-0faa-495d-b6d5-1366104cfb6c	11786	19	f	2026-01-10 03:59:21.829536	K	0	1.0	f
cc6c31dd-8096-4858-ada6-a42c203e1388	d24ad709-1f34-4a5c-94c0-c3be9b11c243	5189	19	f	2026-01-10 05:11:15.513249	K	1	1.0	f
c05a668d-7403-4497-9aa4-5f567950286f	d24ad709-1f34-4a5c-94c0-c3be9b11c243	HOU	19	f	2026-01-10 05:11:15.979774	DEF	1	1.0	f
e576e444-fb8d-4f08-8f60-541968764577	672ac17e-17d2-4773-a623-07026cd98aca	421	19	f	2026-01-10 14:18:28.485496	QB	0	1.0	f
ebd8d342-cb80-436f-887a-724604a37eb8	672ac17e-17d2-4773-a623-07026cd98aca	8150	19	f	2026-01-10 14:18:41.794754	RB	0	1.0	f
4ceacdf8-1ac9-42e0-9215-8096f1837e51	672ac17e-17d2-4773-a623-07026cd98aca	8138	19	f	2026-01-10 14:18:53.73419	RB	0	1.0	f
6cb7cb6b-7417-4d42-aede-6f75b0fcc1f0	672ac17e-17d2-4773-a623-07026cd98aca	9493	19	f	2026-01-10 14:19:03.115056	WR	0	1.0	f
b3f4b122-cdcd-4246-b4b9-b1ac5b042bf8	672ac17e-17d2-4773-a623-07026cd98aca	5859	19	f	2026-01-10 14:19:51.201392	WR	0	1.0	f
bd880ad6-3a6c-4bff-b5bc-0d900901f05b	672ac17e-17d2-4773-a623-07026cd98aca	9488	19	f	2026-01-10 14:20:31.604363	WR	0	1.0	f
5d3cf093-f1d0-4442-b25b-1d2ec4b64058	672ac17e-17d2-4773-a623-07026cd98aca	5022	19	f	2026-01-10 14:21:13.628458	TE	0	1.0	f
3376b197-a03a-47ec-9c32-0e87d04e344b	672ac17e-17d2-4773-a623-07026cd98aca	11789	19	f	2026-01-10 14:21:30.168213	K	0	1.0	f
261822ff-3d2c-48a9-9bcf-4eda3c7974a1	672ac17e-17d2-4773-a623-07026cd98aca	DEN	19	f	2026-01-10 14:21:50.68201	DEF	0	1.0	f
525459fb-93eb-472e-97f2-cc28bdee588d	0477bff2-c2e4-45e2-a00b-225df2154d96	2133	19	f	2026-01-10 14:38:49.429542	WR	0	1.0	f
ae6b39aa-df44-4f83-a2d0-5bae58e30490	c6d87896-425c-4b88-8660-d0f0e532bdae	4034	19	f	2026-01-10 14:47:36.113841	RB	1	1.0	f
f3693132-49e5-47ff-a69d-9674aa3f9db6	96894153-2d54-4b2e-9553-b9e866fd9db3	8150	19	f	2026-01-10 15:07:46.877048	RB	0	1.0	f
d7856ec5-7555-48f4-8abe-24bc62c49399	a08d1c9e-6070-4f64-a674-0a56a35ec792	LAR	19	f	2026-01-10 15:08:03.511609	DEF	0	1.0	f
91d2d56d-76af-405e-8a4f-f2fc329f4a2b	c8c1784c-60e4-4b3d-8efa-7c9fe81aa066	11564	19	f	2026-01-10 15:15:07.021897	QB	0	1.0	f
46849132-dbb5-4c99-a9a7-f47419693411	c8c1784c-60e4-4b3d-8efa-7c9fe81aa066	12529	19	f	2026-01-10 15:15:19.935626	RB	0	1.0	f
49a61036-56c8-4420-9cbc-40f01728e126	336f1ecd-1b0f-42bf-af7f-3eb066b2ea35	11563	19	f	2026-01-10 15:33:07.979332	QB	0	1.0	f
ca23203e-52a5-4678-80f8-9b229957b5a9	336f1ecd-1b0f-42bf-af7f-3eb066b2ea35	8151	19	f	2026-01-10 15:34:18.994128	RB	0	1.0	f
abf2645d-562e-4eae-88e8-0bd4818329ce	336f1ecd-1b0f-42bf-af7f-3eb066b2ea35	5045	19	f	2026-01-10 15:34:31.453067	WR	0	1.0	f
ecf71b5b-5cc3-43c9-bcc7-fb0cfd012ab0	336f1ecd-1b0f-42bf-af7f-3eb066b2ea35	9488	19	f	2026-01-10 15:34:46.160251	WR	0	1.0	f
f3a3a697-ef6d-49fa-ae86-20a76612451b	336f1ecd-1b0f-42bf-af7f-3eb066b2ea35	11627	19	f	2026-01-10 15:37:05.954277	WR	0	1.0	f
dc5d75aa-7163-40e6-8c06-bb6c5ca8446d	336f1ecd-1b0f-42bf-af7f-3eb066b2ea35	11603	19	f	2026-01-10 15:37:40.732736	TE	0	1.0	f
af3e032d-d403-4ec8-b13a-2017023f1d4f	336f1ecd-1b0f-42bf-af7f-3eb066b2ea35	2747	19	f	2026-01-10 15:38:28.012596	K	0	1.0	f
960b99a6-9a7b-49d5-8f1c-e5913c07b8d5	336f1ecd-1b0f-42bf-af7f-3eb066b2ea35	SEA	19	f	2026-01-10 15:39:45.797525	DEF	0	1.0	f
e2b816e4-93eb-4479-95f2-05397c378511	336f1ecd-1b0f-42bf-af7f-3eb066b2ea35	12489	19	f	2026-01-10 15:41:40.001867	RB	0	1.0	f
64ce7df4-4988-4ad5-9477-9212a510eac6	3949b108-442c-4bac-b5c9-3dada8fc19b4	9488	19	f	2026-01-10 18:15:06.914128	WR	0	1.0	f
01d9474e-1b76-43e3-b37b-364c02fc24e3	e5274a58-b24c-45fb-ad7b-711af3d66ea7	8150	19	f	2026-01-10 16:13:28.542914	RB	0	1.0	f
cd1c1b4e-52b4-4b6a-84eb-1f6955ddb149	e5274a58-b24c-45fb-ad7b-711af3d66ea7	2449	19	f	2026-01-10 16:13:52.751042	WR	0	1.0	f
add1bb21-9cfb-4723-98b8-c37b613b679e	e5274a58-b24c-45fb-ad7b-711af3d66ea7	8134	19	f	2026-01-10 16:13:58.018506	WR	0	1.0	f
085da643-9d96-488c-bd09-dca6815afbad	e5274a58-b24c-45fb-ad7b-711af3d66ea7	LAR	19	f	2026-01-10 16:14:11.889603	DEF	0	1.0	f
389f0667-a6c9-48db-9828-3ec8a8e22507	3949b108-442c-4bac-b5c9-3dada8fc19b4	3678	19	f	2026-01-10 18:15:36.822232	K	0	1.0	f
2a0aceb9-9754-4dec-8fee-b7a795ae8f9f	3949b108-442c-4bac-b5c9-3dada8fc19b4	DEN	19	f	2026-01-10 18:15:56.197264	DEF	0	1.0	f
59c6e28c-d635-44c1-94ff-d7dff6002d36	eec1354b-3990-419b-9109-e29562821c54	7569	19	f	2026-01-10 18:42:27.495567	WR	0	1.0	f
8966969a-4af8-4eae-88b6-7079e2b3f943	6c600817-b75f-49d3-8eb3-92b9b4849018	11786	19	f	2026-01-10 19:19:12.718343	K	0	1.0	f
73fe1706-b775-44ff-aa14-4a3065a03446	d56a5f4d-ca57-438b-b2e6-44ab8f51e142	8151	19	f	2026-01-10 20:01:05.163475	RB	1	1.0	f
5b129bb2-40de-4722-a804-6dfb3156d7c8	eec1354b-3990-419b-9109-e29562821c54	HOU	19	f	2026-01-10 18:47:53.663464	DEF	0	1.0	f
4b6b224d-0caf-4d53-98e7-668152855945	eec1354b-3990-419b-9109-e29562821c54	12015	19	f	2026-01-10 18:48:17.215764	K	0	1.0	f
f92bcb65-a8a6-4fc5-87b1-aee007164bc4	eec1354b-3990-419b-9109-e29562821c54	2133	19	f	2026-01-10 18:50:39.552692	WR	0	1.0	f
22aee899-b112-486a-acf4-88e6e3f9b582	eec1354b-3990-419b-9109-e29562821c54	5001	19	f	2026-01-10 18:53:53.20984	TE	0	1.0	f
18c7b1b7-2a48-42c9-b62c-362ba9ca48c1	eec1354b-3990-419b-9109-e29562821c54	12474	19	f	2026-01-10 18:55:21.600837	RB	0	1.0	f
0eb31b4f-0d66-4d54-96d5-69fb0a6b688a	c8c1784c-60e4-4b3d-8efa-7c9fe81aa066	4866	19	f	2026-01-10 16:46:18.004597	RB	0	1.0	f
523e2983-78af-42ff-8b04-6c0861e29861	c8c1784c-60e4-4b3d-8efa-7c9fe81aa066	4177	19	f	2026-01-10 16:46:31.812878	WR	0	1.0	f
310d2e08-e0df-4a9a-b08d-2df3aa652cf4	c8c1784c-60e4-4b3d-8efa-7c9fe81aa066	5859	19	f	2026-01-10 16:46:38.185941	WR	0	1.0	f
4e7fe0ad-da2f-4dcb-ac0a-aa6eb6c67fb0	c8c1784c-60e4-4b3d-8efa-7c9fe81aa066	5022	19	f	2026-01-10 16:47:43.79058	TE	0	1.0	f
7373230e-7b9b-4f40-a159-b42fbdb0a655	c8c1784c-60e4-4b3d-8efa-7c9fe81aa066	9493	19	f	2026-01-10 16:47:53.981135	WR	0	1.0	f
d539b844-8435-4174-9cc0-96daf38dcd96	c8c1784c-60e4-4b3d-8efa-7c9fe81aa066	12713	19	f	2026-01-10 16:48:03.113273	K	0	1.0	f
81de8074-4015-4d09-b6ce-22212ce3e1e6	c8c1784c-60e4-4b3d-8efa-7c9fe81aa066	NE	19	f	2026-01-10 16:48:13.108917	DEF	0	1.0	f
fbfccf48-1449-44f5-a50b-e2b71eafa686	eec1354b-3990-419b-9109-e29562821c54	421	19	f	2026-01-10 16:54:47.891153	QB	0	1.0	f
413bca4f-4833-4085-9553-128c9bb97296	eec1354b-3990-419b-9109-e29562821c54	9493	19	f	2026-01-10 16:55:39.182894	WR	0	1.0	f
2f212f63-cfb8-42b7-8930-f7694969d724	3949b108-442c-4bac-b5c9-3dada8fc19b4	11563	19	f	2026-01-10 17:50:49.060459	QB	0	1.0	f
32494f40-639f-4e30-ac9b-6619b2abd572	3949b108-442c-4bac-b5c9-3dada8fc19b4	6869	19	f	2026-01-10 17:54:13.962472	TE	0	1.0	f
0ec03e4d-bce0-4abd-85de-ac5f843fdb1e	3949b108-442c-4bac-b5c9-3dada8fc19b4	12489	19	f	2026-01-10 18:04:06.414081	RB	0	1.0	f
958fdc82-807c-4012-85f6-29c34b3060d6	3949b108-442c-4bac-b5c9-3dada8fc19b4	8151	19	f	2026-01-10 18:06:40.13497	RB	0	1.0	f
7e2924ae-3298-4d6b-b83f-37f373849461	3949b108-442c-4bac-b5c9-3dada8fc19b4	5045	19	f	2026-01-10 18:12:09.765958	WR	0	1.0	f
a6000fda-6ce9-47cf-88b7-060afcd4a022	3949b108-442c-4bac-b5c9-3dada8fc19b4	11627	19	f	2026-01-10 18:14:01.889129	WR	0	1.0	f
12994e7e-7a2a-4307-b42d-488068007322	eec1354b-3990-419b-9109-e29562821c54	8150	19	f	2026-01-10 18:56:38.935153	RB	0	1.0	f
7aa880b0-07a1-4254-95c2-8eab0b9ec0ac	d56a5f4d-ca57-438b-b2e6-44ab8f51e142	7543	19	f	2026-01-10 20:01:05.233371	RB	1	1.0	f
bd748ae7-8dbd-46a8-bdd3-2b83b92fd9dc	d56a5f4d-ca57-438b-b2e6-44ab8f51e142	9488	19	f	2026-01-10 20:01:05.444641	WR	1	1.0	f
4d7e61d4-12a2-4b67-8d7b-8f12e4981035	d56a5f4d-ca57-438b-b2e6-44ab8f51e142	11786	19	f	2026-01-10 20:01:05.022019	K	1	1.0	f
8552784e-c118-4edf-823e-ee7ec4ca14ca	d56a5f4d-ca57-438b-b2e6-44ab8f51e142	7523	19	f	2026-01-10 20:01:05.092664	QB	1	1.0	f
e9af68b1-6256-4cf5-a29d-e18e7b2929c8	d56a5f4d-ca57-438b-b2e6-44ab8f51e142	9493	19	f	2026-01-10 20:01:05.299765	WR	1	1.0	f
b5cf7636-dae0-441f-9ac5-215d173a70ef	d56a5f4d-ca57-438b-b2e6-44ab8f51e142	SEA	19	f	2026-01-10 20:01:04.962666	DEF	1	1.0	f
453f7756-f5fa-4998-a681-38393843d7c9	6c600817-b75f-49d3-8eb3-92b9b4849018	9493	19	f	2026-01-10 19:18:36.76033	WR	0	1.0	f
d2c44b48-95f1-4c82-bc54-d585ad36ed08	f1f4ea45-5e97-4f49-8e3a-69f307c30f16	2133	19	f	2026-01-10 19:38:52.935472	WR	0	1.0	f
6e6edb3b-6541-4e72-aad8-0c77957de6fa	f1f4ea45-5e97-4f49-8e3a-69f307c30f16	4217	19	f	2026-01-10 19:40:57.971799	TE	0	1.0	f
bba7aa6d-aee8-482f-89bd-cc7b4a2aaa21	f1f4ea45-5e97-4f49-8e3a-69f307c30f16	12713	19	f	2026-01-10 19:44:34.080077	K	0	1.0	f
737363b7-431b-4441-b292-1b5944f1d01a	817cf03b-a6c5-4fef-bb3d-825f6bb52c4d	421	19	f	2026-01-10 19:52:47.285765	QB	0	1.0	f
b2c6bc9f-0da1-48f8-b7eb-2c413815201a	d56a5f4d-ca57-438b-b2e6-44ab8f51e142	9487	19	f	2026-01-10 20:01:05.368504	WR	1	1.0	f
3b0df9f0-3ee1-45a0-b201-f715b5e058f3	817cf03b-a6c5-4fef-bb3d-825f6bb52c4d	2133	19	f	2026-01-10 19:53:32.129053	WR	0	1.0	f
a1cb0914-8d7a-4222-95f1-dd9ad149d268	d56a5f4d-ca57-438b-b2e6-44ab8f51e142	9480	19	f	2026-01-10 20:01:05.518236	TE	1	1.0	f
00260840-b046-422a-9e4b-df92758e276c	817cf03b-a6c5-4fef-bb3d-825f6bb52c4d	8150	19	f	2026-01-10 20:02:33.717325	RB	0	1.0	f
2214c340-e448-4a43-b330-eee8f8563eec	96894153-2d54-4b2e-9553-b9e866fd9db3	5859	19	f	2026-01-10 20:04:17.760782	WR	0	1.0	f
87dfefb8-f1ec-4ca2-b49e-24364e07c49d	96894153-2d54-4b2e-9553-b9e866fd9db3	5022	19	f	2026-01-10 20:04:42.735344	TE	0	1.0	f
ac210be1-3fcb-4d26-b15c-aacae7ab16b6	817cf03b-a6c5-4fef-bb3d-825f6bb52c4d	5022	19	f	2026-01-10 20:07:11.594077	TE	0	1.0	f
3c626760-6ed8-4ea9-adb9-45ff6db54be8	817cf03b-a6c5-4fef-bb3d-825f6bb52c4d	9487	19	f	2026-01-10 20:07:23.911025	WR	0	1.0	f
ba6b5d3d-947f-4883-9dc5-d44f4f5b89e6	817cf03b-a6c5-4fef-bb3d-825f6bb52c4d	9493	19	f	2026-01-10 20:07:55.591572	WR	0	1.0	f
0c0e724c-89ef-4421-a875-314712bb5ada	817cf03b-a6c5-4fef-bb3d-825f6bb52c4d	12015	19	f	2026-01-10 20:08:36.516224	K	0	1.0	f
76a7ece6-9073-4a00-8cf6-de9926d69c93	817cf03b-a6c5-4fef-bb3d-825f6bb52c4d	LAR	19	f	2026-01-10 20:08:52.831762	DEF	0	1.0	f
eeaac3d3-d12f-4b5e-af20-c26d43b8f988	817cf03b-a6c5-4fef-bb3d-825f6bb52c4d	4866	19	f	2026-01-10 20:12:12.107505	RB	0	1.0	f
1d19b44e-aa03-402e-b47e-71f6f6c99d9e	6c600817-b75f-49d3-8eb3-92b9b4849018	7523	19	f	2026-01-10 20:42:39.00451	QB	0	1.0	f
3a5d8e31-4a89-414d-b879-f9a25b934de8	6c600817-b75f-49d3-8eb3-92b9b4849018	5850	19	f	2026-01-10 20:43:39.477562	RB	0	1.0	f
873ede2d-613f-46de-8f74-6953874ace4c	6c600817-b75f-49d3-8eb3-92b9b4849018	5859	19	f	2026-01-10 20:44:07.025988	WR	0	1.0	f
bf7bf2a5-a33e-456a-81a6-2069cd4b2038	6c600817-b75f-49d3-8eb3-92b9b4849018	8167	19	f	2026-01-10 20:46:30.360258	WR	0	1.0	f
4a3f4ebf-e68b-4679-8f45-6377fc57f2fa	6c600817-b75f-49d3-8eb3-92b9b4849018	4034	19	f	2026-01-10 20:46:57.473211	RB	0	1.0	f
78f85cdc-41d9-4d49-859f-8c16a87de924	6c600817-b75f-49d3-8eb3-92b9b4849018	3214	19	f	2026-01-10 20:47:22.39316	TE	0	1.0	f
ef84d0be-2d49-4fcb-954c-4de68ce679a8	6c600817-b75f-49d3-8eb3-92b9b4849018	NE	19	f	2026-01-10 20:47:49.310005	DEF	0	1.0	f
9a920246-a5f0-40a9-848e-5a71e2dc6397	8dbba58f-a902-46c5-acdd-367ebe5822e8	11564	19	f	2026-01-10 20:51:52.517764	QB	0	1.0	f
21de1411-915c-4de5-a2fe-f3039c6bf770	8dbba58f-a902-46c5-acdd-367ebe5822e8	4866	19	f	2026-01-10 20:53:20.075715	RB	0	1.0	f
bb6136f1-5582-476b-a056-07b745d09da4	8dbba58f-a902-46c5-acdd-367ebe5822e8	12529	19	f	2026-01-10 20:53:48.357181	RB	0	1.0	f
f993f729-2c6f-4d66-9c73-e7595b381356	8dbba58f-a902-46c5-acdd-367ebe5822e8	7525	19	f	2026-01-10 20:54:08.069494	WR	0	1.0	f
3c0e303c-47b5-4413-96ef-147278c52af2	8dbba58f-a902-46c5-acdd-367ebe5822e8	5859	19	f	2026-01-10 20:54:18.44684	WR	0	1.0	f
3b965cdf-ff73-4b06-834b-d8e8d4695657	8dbba58f-a902-46c5-acdd-367ebe5822e8	2449	19	f	2026-01-10 20:54:34.119173	WR	0	1.0	f
dc953879-03b0-4f39-883e-662a469809b8	8dbba58f-a902-46c5-acdd-367ebe5822e8	3214	19	f	2026-01-10 20:54:53.514837	TE	0	1.0	f
7add7f6b-252f-4599-a2bd-6e6be396954e	8dbba58f-a902-46c5-acdd-367ebe5822e8	12713	19	f	2026-01-10 20:55:18.687124	K	0	1.0	f
55f9a3cb-f3e1-4e24-8c40-9727e770c347	8dbba58f-a902-46c5-acdd-367ebe5822e8	NE	19	f	2026-01-10 20:55:30.495235	DEF	0	1.0	f
c61fbde3-b676-4b8a-b65f-b80cfea44c0a	4cd229d9-1f32-451c-9244-45ae08835419	4984	19	f	2026-01-10 21:04:04.757113	QB	0	1.0	f
8581f911-4200-408a-aa6f-8e6857c03d4b	4cd229d9-1f32-451c-9244-45ae08835419	4866	19	f	2026-01-10 21:04:27.533521	RB	0	1.0	f
28fc3261-2259-4e80-b9bd-d8b840a879e1	4cd229d9-1f32-451c-9244-45ae08835419	8151	19	f	2026-01-10 21:04:52.529465	RB	0	1.0	f
e7b31ab6-4986-47ff-a17e-b7ef9ba62c44	4cd229d9-1f32-451c-9244-45ae08835419	2133	19	f	2026-01-10 21:05:15.865673	WR	0	1.0	f
f2f3449a-41cf-431b-ae76-b4a88da8bd58	4cd229d9-1f32-451c-9244-45ae08835419	9488	19	f	2026-01-10 21:05:40.12518	WR	0	1.0	f
9a60050e-e59a-4fac-8352-c9e5088df420	4cd229d9-1f32-451c-9244-45ae08835419	12526	19	f	2026-01-10 21:06:47.589223	WR	0	1.0	f
c93a44cb-9c52-49f4-adb4-7bddc59d81bf	4cd229d9-1f32-451c-9244-45ae08835419	4217	19	f	2026-01-10 21:07:52.249685	TE	0	1.0	f
ac8da007-ccd3-404a-9257-a8ec2203b346	4cd229d9-1f32-451c-9244-45ae08835419	11786	19	f	2026-01-10 21:08:11.053259	K	0	1.0	f
85f9fb4e-44f0-4190-9db3-ac69aea949f3	4cd229d9-1f32-451c-9244-45ae08835419	HOU	19	f	2026-01-10 21:08:20.317372	DEF	0	1.0	f
\.


--
-- Data for Name: player_swaps; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.player_swaps (id, user_id, old_player_id, new_player_id, "position", week_number, swapped_at) FROM stdin;
\.


--
-- Data for Name: players; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.players (id, "position", team, available, created_at, sleeper_id, full_name, is_active, game_time, first_name, last_name, status, injury_status, years_exp, number, updated_at, espn_id, image_url) FROM stdin;
10214	TE	LAR	t	2025-11-13 16:40:14.227999	10214	Davis Allen	t	\N	Davis	Allen	Active	\N	0	87	2025-11-13 16:40:14.227999	4426553	https://sleepercdn.com/content/nfl/players/10214.jpg
96	QB	PIT	t	2025-11-11 23:14:18.109324	96	Aaron Rodgers	t	\N	Aaron	Rodgers	Active	\N	0	8	2025-11-13 16:40:12.949339	8439	https://sleepercdn.com/content/nfl/players/96.jpg
421	QB	LAR	t	2025-11-11 23:14:18.119021	421	Matthew Stafford	t	\N	Matthew	Stafford	Active	\N	0	9	2025-11-13 16:40:12.962137	12483	https://sleepercdn.com/content/nfl/players/421.jpg
1433	K	GB	t	2025-11-11 23:14:18.130049	1433	Brandon McManus	t	\N	Brandon	McManus	Active	\N	0	17	2025-11-13 16:40:13.02097	16339	https://sleepercdn.com/content/nfl/players/1433.jpg
1466	TE	KC	t	2025-11-11 23:14:18.136994	1466	Travis Kelce	t	\N	Travis	Kelce	Active	\N	0	87	2025-11-13 16:40:13.026827	15847	https://sleepercdn.com/content/nfl/players/1466.jpg
1837	QB	LAR	t	2025-11-11 23:14:18.152284	1837	Jimmy Garoppolo	t	\N	Jimmy	Garoppolo	Active	\N	0	11	2025-11-13 16:40:13.032451	16760	https://sleepercdn.com/content/nfl/players/1837.jpg
1945	K	PIT	t	2025-11-11 23:14:18.159456	1945	Chris Boswell	t	\N	Chris	Boswell	Active	\N	0	9	2025-11-13 16:40:13.04102	17372	https://sleepercdn.com/content/nfl/players/1945.jpg
2133	WR	LAR	t	2025-11-11 23:14:18.168698	2133	Davante Adams	t	\N	Davante	Adams	Active	Questionable	0	17	2025-11-13 16:40:13.053116	16800	https://sleepercdn.com/content/nfl/players/2133.jpg
3163	QB	DET	t	2025-11-11 23:14:18.181931	3163	Jared Goff	t	\N	Jared	Goff	Active	\N	0	16	2025-11-13 16:40:13.110315	3046779	https://sleepercdn.com/content/nfl/players/3163.jpg
3198	RB	BAL	t	2025-11-11 23:14:18.188069	3198	Derrick Henry	t	\N	Derrick	Henry	Active	\N	0	22	2025-11-13 16:40:13.116745	3043078	https://sleepercdn.com/content/nfl/players/3198.jpg
3271	TE	LAR	t	2025-11-11 23:14:18.19402	3271	Tyler Higbee	t	\N	Tyler	Higbee	Active	\N	0	89	2025-11-13 16:40:13.145046	2573401	https://sleepercdn.com/content/nfl/players/3271.jpg
3976	QB	BUF	t	2025-11-11 23:14:18.212953	3976	Mitchell Trubisky	t	\N	Mitchell	Trubisky	Active	\N	0	11	2025-11-13 16:40:13.173729	3039707	https://sleepercdn.com/content/nfl/players/3976.jpg
4046	QB	KC	t	2025-11-11 23:14:18.219124	4046	Patrick Mahomes	t	\N	Patrick	Mahomes	Active	\N	0	15	2025-11-13 16:40:13.196412	3139477	https://sleepercdn.com/content/nfl/players/4046.jpg
4098	RB	KC	t	2025-11-11 23:14:18.230879	4098	Kareem Hunt	t	\N	Kareem	Hunt	Active	\N	0	29	2025-11-13 16:40:13.208662	3059915	https://sleepercdn.com/content/nfl/players/4098.jpg
4144	TE	PIT	t	2025-11-11 23:14:18.236633	4144	Jonnu Smith	t	\N	Jonnu	Smith	Active	\N	0	81	2025-11-13 16:40:13.214598	3054212	https://sleepercdn.com/content/nfl/players/4144.jpg
4227	K	KC	t	2025-11-11 23:14:18.261059	4227	Harrison Butker	t	\N	Harrison	Butker	Active	\N	0	7	2025-11-13 16:40:13.25865	3055899	https://sleepercdn.com/content/nfl/players/4227.jpg
4866	RB	PHI	t	2025-11-11 23:14:18.267053	4866	Saquon Barkley	t	\N	Saquon	Barkley	Active	\N	0	26	2025-11-13 16:40:13.287618	3929630	https://sleepercdn.com/content/nfl/players/4866.jpg
4892	QB	TB	t	2025-11-11 23:14:18.280371	4892	Baker Mayfield	t	\N	Baker	Mayfield	Active	\N	0	6	2025-11-13 16:40:13.300307	3052587	https://sleepercdn.com/content/nfl/players/4892.jpg
4950	WR	HOU	t	2025-11-11 23:14:18.286756	4950	Christian Kirk	t	\N	Christian	Kirk	Active	\N	0	13	2025-11-13 16:40:13.311609	3895856	https://sleepercdn.com/content/nfl/players/4950.jpg
4988	RB	HOU	t	2025-11-11 23:14:18.306195	4988	Nick Chubb	t	\N	Nick	Chubb	Active	\N	0	21	2025-11-13 16:40:13.339621	3128720	https://sleepercdn.com/content/nfl/players/4988.jpg
5001	TE	HOU	t	2025-11-11 23:14:18.313719	5001	Dalton Schultz	t	\N	Dalton	Schultz	Active	Questionable	0	86	2025-11-13 16:40:13.352836	3117256	https://sleepercdn.com/content/nfl/players/5001.jpg
5012	TE	BAL	t	2025-11-11 23:14:18.320066	5012	Mark Andrews	t	\N	Mark	Andrews	Active	\N	0	89	2025-11-13 16:40:13.367941	3116365	https://sleepercdn.com/content/nfl/players/5012.jpg
5045	WR	DEN	t	2025-11-11 23:14:18.332846	5045	Courtland Sutton	t	\N	Courtland	Sutton	Active	\N	0	14	2025-11-13 16:40:13.380532	3128429	https://sleepercdn.com/content/nfl/players/5045.jpg
5127	QB	DET	t	2025-11-11 23:14:18.340127	5127	Kyle Allen	t	\N	Kyle	Allen	Active	\N	0	8	2025-11-13 16:40:13.398457	3115293	https://sleepercdn.com/content/nfl/players/5127.jpg
5846	WR	PIT	t	2025-11-11 23:14:18.35804	5846	DK Metcalf	t	\N	DK	Metcalf	Active	\N	0	4	2025-11-13 16:40:13.433642	4047650	https://sleepercdn.com/content/nfl/players/5846.jpg
5850	RB	GB	t	2025-11-11 23:14:18.364033	5850	Josh Jacobs	t	\N	Josh	Jacobs	Active	\N	0	8	2025-11-13 16:40:13.439822	4047365	https://sleepercdn.com/content/nfl/players/5850.jpg
5892	RB	DET	t	2025-11-11 23:14:18.376561	5892	David Montgomery	t	\N	David	Montgomery	Active	\N	0	5	2025-11-13 16:40:13.474307	4035538	https://sleepercdn.com/content/nfl/players/5892.jpg
5906	TE	BUF	t	2025-11-11 23:14:18.382529	5906	Dawson Knox	t	\N	Dawson	Knox	Active	\N	0	88	2025-11-13 16:40:13.480778	3930086	https://sleepercdn.com/content/nfl/players/5906.jpg
6011	QB	KC	t	2025-11-11 23:14:18.401035	6011	Gardner Minshew	t	\N	Gardner	Minshew	Active	\N	0	17	2025-11-13 16:40:13.522316	4038524	https://sleepercdn.com/content/nfl/players/6011.jpg
6039	RB	BUF	t	2025-11-11 23:14:18.406992	6039	Ty Johnson	t	\N	Ty	Johnson	Active	\N	0	26	2025-11-13 16:40:13.528156	3915411	https://sleepercdn.com/content/nfl/players/6039.jpg
6136	QB	DEN	t	2025-11-11 23:14:18.412808	6136	Jarrett Stidham	t	\N	Jarrett	Stidham	Active	\N	0	8	2025-11-13 16:40:13.553265	3892775	https://sleepercdn.com/content/nfl/players/6136.jpg
6650	K	TB	t	2025-11-11 23:14:18.425172	6650	Chase McLaughlin	t	\N	Chase	McLaughlin	Active	\N	0	4	2025-11-13 16:40:13.577485	3150744	https://sleepercdn.com/content/nfl/players/6650.jpg
6794	WR	MIN	t	2025-11-11 23:14:18.431774	6794	Justin Jefferson	t	\N	Justin	Jefferson	Active	\N	0	18	2025-11-13 16:40:13.604983	4262921	https://sleepercdn.com/content/nfl/players/6794.jpg
6804	QB	GB	t	2025-11-11 23:14:18.450202	6804	Jordan Love	t	\N	Jordan	Love	Active	\N	0	10	2025-11-13 16:40:13.621793	4036378	https://sleepercdn.com/content/nfl/players/6804.jpg
6806	RB	DEN	t	2025-11-11 23:14:18.457089	6806	J.K. Dobbins	t	\N	J.K.	Dobbins	Active	Questionable	0	27	2025-11-13 16:40:13.627146	4241985	https://sleepercdn.com/content/nfl/players/6806.jpg
6869	TE	DEN	t	2025-11-11 23:14:18.475424	6869	Adam Trautman	t	\N	Adam	Trautman	Active	\N	0	82	2025-11-13 16:40:13.655383	3911853	https://sleepercdn.com/content/nfl/players/6869.jpg
6904	QB	PHI	t	2025-11-11 23:14:18.481787	6904	Jalen Hurts	t	\N	Jalen	Hurts	Active	\N	0	1	2025-11-13 16:40:13.662031	4040715	https://sleepercdn.com/content/nfl/players/6904.jpg
7042	K	BUF	t	2025-11-11 23:14:18.488148	7042	Tyler Bass	t	\N	Tyler	Bass	Inactive	IR	0	2	2025-11-13 16:40:13.684389	3917232	https://sleepercdn.com/content/nfl/players/7042.jpg
1479	WR	LAC	t	2025-11-11 23:14:18.144894	1479	Keenan Allen	t	\N	Keenan	Allen	Active	\N	0	13	2025-11-11 23:14:18.144894	15818	https://sleepercdn.com/content/nfl/players/1479.jpg
7567	RB	PIT	t	2025-11-11 23:14:18.519606	7567	Kenneth Gainwell	t	\N	Kenneth	Gainwell	Active	\N	0	14	2025-11-13 16:40:13.765984	4371733	https://sleepercdn.com/content/nfl/players/7567.jpg
4984	QB	BUF	t	2025-11-11 23:14:18.299707	4984	Josh Allen	t	\N	Josh	Allen	Active	\N	0	17	2025-11-13 16:40:13.334188	3918298	https://sleepercdn.com/content/nfl/players/4984.jpg
8150	RB	LAR	t	2025-11-11 23:14:18.619606	8150	Kyren Williams	t	\N	Kyren	Williams	Active	\N	0	23	2025-11-13 16:40:13.957641	4430737	https://sleepercdn.com/content/nfl/players/8150.jpg
7600	TE	PIT	t	2025-11-11 23:14:18.543455	7600	Pat Freiermuth	t	\N	Pat	Freiermuth	Active	\N	0	88	2025-11-13 16:40:13.799587	4361411	https://sleepercdn.com/content/nfl/players/7600.jpg
7610	QB	LAC	t	2025-11-11 23:14:18.549913	7610	Trey Lance	t	\N	Trey	Lance	Active	\N	0	5	2025-11-13 16:40:13.805184	4383351	https://sleepercdn.com/content/nfl/players/7610.jpg
8121	WR	GB	t	2025-11-11 23:14:18.575171	8121	Romeo Doubs	t	\N	Romeo	Doubs	Active	\N	0	87	2025-11-13 16:40:13.873787	4361432	https://sleepercdn.com/content/nfl/players/8121.jpg
8131	TE	BAL	t	2025-11-11 23:14:18.587018	8131	Isaiah Likely	t	\N	Isaiah	Likely	Active	Questionable	0	80	2025-11-13 16:40:13.901773	4361050	https://sleepercdn.com/content/nfl/players/8131.jpg
9225	RB	PHI	t	2025-11-11 23:14:18.697477	9225	Tank Bigsby	t	\N	Tank	Bigsby	Active	\N	0	37	2025-11-13 16:40:14.10276	4429013	https://sleepercdn.com/content/nfl/players/9225.jpg
8161	QB	GB	t	2025-11-11 23:14:18.62587	8161	Malik Willis	t	\N	Malik	Willis	Active	\N	0	2	2025-11-13 16:40:13.985797	4242512	https://sleepercdn.com/content/nfl/players/8161.jpg
8177	TE	PHI	t	2025-11-11 23:14:18.638615	8177	Grant Calcaterra	t	\N	Grant	Calcaterra	Active	\N	0	81	2025-11-13 16:40:14.001781	4241374	https://sleepercdn.com/content/nfl/players/8177.jpg
8205	RB	KC	t	2025-11-11 23:14:18.65153	8205	Isiah Pacheco	t	\N	Isiah	Pacheco	Active	Questionable	0	10	2025-11-13 16:40:14.022368	4361529	https://sleepercdn.com/content/nfl/players/8205.jpg
8259	K	LAC	t	2025-11-11 23:14:18.666026	8259	Cameron Dicker	t	\N	Cameron	Dicker	Active	\N	0	11	2025-11-13 16:40:14.05072	4362081	https://sleepercdn.com/content/nfl/players/8259.jpg
9481	TE	GB	t	2025-11-11 23:14:18.710672	9481	Luke Musgrave	t	\N	Luke	Musgrave	Active	\N	0	88	2025-11-13 16:40:14.135818	4428085	https://sleepercdn.com/content/nfl/players/9481.jpg
9758	QB	HOU	t	2025-11-11 23:14:18.736282	9758	C.J. Stroud	t	\N	C.J.	Stroud	Active	Questionable	0	7	2025-11-13 16:40:14.211146	4432577	https://sleepercdn.com/content/nfl/players/9758.jpg
11563	QB	DEN	t	2025-11-11 23:14:18.777417	11563	Bo Nix	t	\N	Bo	Nix	Active	\N	0	10	2025-11-13 16:40:14.368282	4426338	https://sleepercdn.com/content/nfl/players/11563.jpg
11627	WR	DEN	t	2025-11-11 23:14:18.80057	11627	Troy Franklin	t	\N	Troy	Franklin	Active	\N	0	11	2025-11-13 16:40:14.447051	4431280	https://sleepercdn.com/content/nfl/players/11627.jpg
11789	K	LAR	t	2025-11-11 23:14:18.825801	11789	Joshua Karty	t	\N	Joshua	Karty	Active	\N	0	16	2025-11-13 16:40:14.504389	4566192	https://sleepercdn.com/content/nfl/players/11789.jpg
11792	K	MIN	t	2025-11-11 23:14:18.83184	11792	Will Reichard	t	\N	Will	Reichard	Active	\N	0	16	2025-11-13 16:40:14.510553	4567104	https://sleepercdn.com/content/nfl/players/11792.jpg
12474	RB	HOU	t	2025-11-11 23:14:18.8435	12474	Woody Marks	t	\N	Woody	Marks	Active	\N	0	27	2025-11-13 16:40:14.558401	4429059	https://sleepercdn.com/content/nfl/players/12474.jpg
12485	WR	TB	t	2025-11-11 23:14:18.849223	12485	Tez Johnson	t	\N	Tez	Johnson	Active	\N	0	15	2025-11-13 16:40:14.564834	4608810	https://sleepercdn.com/content/nfl/players/12485.jpg
12514	WR	TB	t	2025-11-11 23:14:18.87225	12514	Emeka Egbuka	t	\N	Emeka	Egbuka	Active	\N	0	2	2025-11-13 16:40:14.644243	4567750	https://sleepercdn.com/content/nfl/players/12514.jpg
HOU	DEF	HOU	t	2025-11-11 23:14:18.898304	HOU	Houston Texans	t	\N	Houston	Texans	Active	\N	0	\N	2025-11-13 16:40:14.754994	\N	https://sleepercdn.com/images/team_logos/nfl/hou.png
BAL	DEF	BAL	t	2025-11-11 23:14:18.904211	BAL	Baltimore Ravens	t	\N	Baltimore	Ravens	Active	\N	0	\N	2025-11-13 16:40:14.768028	\N	https://sleepercdn.com/images/team_logos/nfl/bal.png
LAC	DEF	LAC	t	2025-11-11 23:14:18.916045	LAC	Los Angeles Chargers	t	\N	Los Angeles	Chargers	Active	\N	0	\N	2025-11-13 16:40:14.823489	\N	https://sleepercdn.com/images/team_logos/nfl/lac.png
TB	DEF	TB	t	2025-11-11 23:14:18.92237	TB	Tampa Bay Buccaneers	t	\N	Tampa Bay	Buccaneers	Active	\N	0	\N	2025-11-13 16:40:14.82898	\N	https://sleepercdn.com/images/team_logos/nfl/tb.png
GB	DEF	GB	t	2025-11-11 23:14:18.934474	GB	Green Bay Packers	t	\N	Green Bay	Packers	Active	\N	0	\N	2025-11-13 16:40:14.870919	\N	https://sleepercdn.com/images/team_logos/nfl/gb.png
DET	DEF	DET	t	2025-11-11 23:14:18.940552	DET	Detroit Lions	t	\N	Detroit	Lions	Active	\N	0	\N	2025-11-13 16:40:14.886601	\N	https://sleepercdn.com/images/team_logos/nfl/det.png
3678	K	DEN	t	2025-11-11 23:14:18.206889	3678	Wil Lutz	t	\N	Wil	Lutz	Active	\N	0	3	2025-11-13 16:40:13.16798	2985659	https://sleepercdn.com/content/nfl/players/3678.jpg
8125	WR	PIT	t	2025-11-11 23:14:18.581049	8125	Calvin Austin	t	\N	Calvin	Austin	Active	\N	0	19	2025-11-13 16:40:13.8857	4243389	https://sleepercdn.com/content/nfl/players/8125.jpg
4066	TE	DEN	t	2025-11-11 23:14:18.225041	4066	Evan Engram	t	\N	Evan	Engram	Active	\N	0	1	2025-11-13 16:40:13.202542	3051876	https://sleepercdn.com/content/nfl/players/4066.jpg
4195	K	PHI	t	2025-11-11 23:14:18.242535	4195	Jake Elliott	t	\N	Jake	Elliott	Active	\N	0	4	2025-11-13 16:40:13.239523	3050478	https://sleepercdn.com/content/nfl/players/4195.jpg
4881	QB	BAL	t	2025-11-11 23:14:18.273505	4881	Lamar Jackson	t	\N	Lamar	Jackson	Active	Questionable	0	8	2025-11-13 16:40:13.293801	3916387	https://sleepercdn.com/content/nfl/players/4881.jpg
4972	QB	PIT	t	2025-11-11 23:14:18.292935	4972	Mason Rudolph	t	\N	Mason	Rudolph	Active	\N	0	2	2025-11-13 16:40:13.317262	3116407	https://sleepercdn.com/content/nfl/players/4972.jpg
5022	TE	PHI	t	2025-11-11 23:14:18.326859	5022	Dallas Goedert	t	\N	Dallas	Goedert	Active	\N	0	88	2025-11-13 16:40:13.374776	3121023	https://sleepercdn.com/content/nfl/players/5022.jpg
5844	TE	MIN	t	2025-11-11 23:14:18.352234	5844	T.J. Hockenson	t	\N	T.J.	Hockenson	Active	\N	0	87	2025-11-13 16:40:13.426884	4036133	https://sleepercdn.com/content/nfl/players/5844.jpg
5859	WR	PHI	t	2025-11-11 23:14:18.369933	5859	A.J. Brown	t	\N	A.J.	Brown	Active	\N	0	11	2025-11-13 16:40:13.457839	4047646	https://sleepercdn.com/content/nfl/players/5859.jpg
5995	RB	BAL	t	2025-11-11 23:14:18.395022	5995	Justice Hill	t	\N	Justice	Hill	Active	Questionable	0	43	2025-11-13 16:40:13.516169	4038441	https://sleepercdn.com/content/nfl/players/5995.jpg
6268	K	HOU	t	2025-11-11 23:14:18.418888	6268	Matthew Wright	t	\N	Matthew	Wright	Active	\N	0	42	2025-11-13 16:40:13.565768	3128444	https://sleepercdn.com/content/nfl/players/6268.jpg
6797	QB	LAC	t	2025-11-11 23:14:18.442274	6797	Justin Herbert	t	\N	Justin	Herbert	Active	\N	0	10	2025-11-13 16:40:13.610784	4038941	https://sleepercdn.com/content/nfl/players/6797.jpg
6850	TE	HOU	t	2025-11-11 23:14:18.467917	6850	Harrison Bryant	t	\N	Harrison	Bryant	Active	Questionable	0	88	2025-11-13 16:40:13.649504	4040774	https://sleepercdn.com/content/nfl/players/6850.jpg
7083	QB	BAL	t	2025-11-11 23:14:18.494238	7083	Tyler Huntley	t	\N	Tyler	Huntley	Active	\N	0	5	2025-11-13 16:40:13.696067	4035671	https://sleepercdn.com/content/nfl/players/7083.jpg
10229	WR	KC	t	2025-11-11 23:14:18.753921	10229	Rashee Rice	t	\N	Rashee	Rice	Active	\N	0	4	2025-11-13 16:40:14.244741	4428331	https://sleepercdn.com/content/nfl/players/10229.jpg
10236	TE	BUF	t	2026-01-07 19:31:18.595788	10236	Dalton Kincaid	t	\N	Dalton	Kincaid	Active	\N	0	\N	2026-01-07 19:40:20.501571	4385690	https://sleepercdn.com/content/nfl/players/10236.jpg
5272	K	LV	t	2025-11-13 16:40:13.415936	5272	Greg Joseph	t	\N	Greg	Joseph	Active	\N	0	34	2025-11-13 16:40:13.415936	3975763	https://sleepercdn.com/content/nfl/players/5272.jpg
5409	TE	CIN	t	2025-11-13 16:40:13.421349	5409	Tanner Hudson	t	\N	Tanner	Hudson	Active	\N	0	87	2025-11-13 16:40:13.421349	3050481	https://sleepercdn.com/content/nfl/players/5409.jpg
19	QB	CIN	t	2025-11-13 16:40:12.941352	19	Joe Flacco	t	\N	Joe	Flacco	Active	Questionable	0	16	2025-11-13 16:40:12.941352	11252	https://sleepercdn.com/content/nfl/players/19.jpg
260	QB	WAS	t	2025-11-13 16:40:12.955874	260	Josh Johnson	t	\N	Josh	Johnson	Active	\N	0	14	2025-11-13 16:40:12.955874	11394	https://sleepercdn.com/content/nfl/players/260.jpg
650	K	NYJ	t	2025-11-13 16:40:12.977165	650	Nick Folk	t	\N	Nick	Folk	Active	\N	0	6	2025-11-13 16:40:12.977165	10621	https://sleepercdn.com/content/nfl/players/650.jpg
827	QB	NYJ	t	2025-11-13 16:40:12.983149	827	Tyrod Taylor	t	\N	Tyrod	Taylor	Active	\N	0	2	2025-11-13 16:40:12.983149	14163	https://sleepercdn.com/content/nfl/players/827.jpg
DEN	DEF	DEN	t	2025-11-11 23:14:18.959624	DEN	Denver Broncos	t	\N	Denver	Broncos	Active	\N	0	\N	2025-11-13 16:40:14.934983	\N	https://sleepercdn.com/images/team_logos/nfl/den.png
3269	WR	WAS	t	2025-11-13 16:40:13.139639	3269	Chris Moore	t	\N	Chris	Moore	Active	\N	0	19	2025-11-13 16:40:13.139639	2576581	https://sleepercdn.com/content/nfl/players/3269.jpg
829	QB	CAR	t	2025-11-13 16:40:12.99066	829	Andy Dalton	t	\N	Andy	Dalton	Active	\N	0	14	2025-11-13 16:40:12.99066	14012	https://sleepercdn.com/content/nfl/players/829.jpg
8138	RB	BUF	t	2025-11-11 23:14:18.60682	8138	James Cook	t	\N	James	Cook	Active	\N	0	4	2025-11-13 16:40:13.930279	4379399	https://sleepercdn.com/content/nfl/players/8138.jpg
4983	WR	CHI	t	2025-11-13 16:40:13.328813	4983	DJ Moore	t	\N	DJ	Moore	Active	Questionable	0	2	2025-11-13 16:40:13.328813	12429	https://sleepercdn.com/content/nfl/players/4983.jpg
1339	TE	WAS	t	2025-11-13 16:40:13.002904	1339	Zach Ertz	t	\N	Zach	Ertz	Active	\N	0	86	2025-11-13 16:40:13.002904	15835	https://sleepercdn.com/content/nfl/players/1339.jpg
1373	QB	LV	t	2025-11-13 16:40:13.008861	1373	Geno Smith	t	\N	Geno	Smith	Active	Questionable	0	7	2025-11-13 16:40:13.008861	15864	https://sleepercdn.com/content/nfl/players/1373.jpg
2020	K	CHI	t	2025-11-13 16:40:13.047012	2020	Cairo Santos	t	\N	Cairo	Santos	Active	\N	0	8	2025-11-13 16:40:13.047012	17427	https://sleepercdn.com/content/nfl/players/2020.jpg
2197	WR	NO	t	2025-11-13 16:40:13.066426	2197	Brandin Cooks	t	\N	Brandin	Cooks	Active	\N	0	10	2025-11-13 16:40:13.066426	16731	https://sleepercdn.com/content/nfl/players/2197.jpg
2307	QB	WAS	t	2025-11-13 16:40:13.079806	2307	Marcus Mariota	t	\N	Marcus	Mariota	Active	\N	0	8	2025-11-13 16:40:13.079806	2576980	https://sleepercdn.com/content/nfl/players/2307.jpg
2374	WR	LV	t	2025-11-13 16:40:13.085914	2374	Tyler Lockett	t	\N	Tyler	Lockett	Active	\N	0	17	2025-11-13 16:40:13.085914	2577327	https://sleepercdn.com/content/nfl/players/2374.jpg
2747	K	SEA	t	2025-11-13 16:40:13.098085	2747	Jason Myers	t	\N	Jason	Myers	Active	\N	0	5	2025-11-13 16:40:13.098085	2473037	https://sleepercdn.com/content/nfl/players/2747.jpg
2749	RB	LV	t	2025-11-13 16:40:13.10438	2749	Raheem Mostert	t	\N	Raheem	Mostert	Active	\N	0	31	2025-11-13 16:40:13.10438	2576414	https://sleepercdn.com/content/nfl/players/2749.jpg
3214	TE	NE	t	2025-11-13 16:40:13.128735	3214	Hunter Henry	t	\N	Hunter	Henry	Active	\N	0	85	2025-11-13 16:40:13.128735	3046439	https://sleepercdn.com/content/nfl/players/3214.jpg
3257	QB	ARI	t	2025-11-13 16:40:13.134183	3257	Jacoby Brissett	t	\N	Jacoby	Brissett	Active	\N	0	7	2025-11-13 16:40:13.134183	2578570	https://sleepercdn.com/content/nfl/players/3257.jpg
3357	QB	TEN	t	2025-11-13 16:40:13.156058	3357	Brandon Allen	t	\N	Brandon	Allen	Active	\N	0	10	2025-11-13 16:40:13.156058	2574511	https://sleepercdn.com/content/nfl/players/3357.jpg
3451	K	HOU	t	2025-11-11 23:14:18.200357	3451	Ka'imi Fairbairn	t	\N	Ka'imi	Fairbairn	Active	Questionable	0	15	2025-11-13 16:40:13.161562	2971573	https://sleepercdn.com/content/nfl/players/3451.jpg
4034	RB	SF	t	2025-11-13 16:40:13.184669	4034	Christian McCaffrey	t	\N	Christian	McCaffrey	Active	\N	0	23	2025-11-13 16:40:13.184669	3117251	https://sleepercdn.com/content/nfl/players/4034.jpg
4035	RB	NO	t	2025-11-13 16:40:13.190345	4035	Alvin Kamara	t	\N	Alvin	Kamara	Active	\N	0	41	2025-11-13 16:40:13.190345	3054850	https://sleepercdn.com/content/nfl/players/4035.jpg
4177	WR	NE	t	2025-11-13 16:40:13.226901	4177	Mack Hollins	t	\N	Mack	Hollins	Active	\N	0	13	2025-11-13 16:40:13.226901	2991662	https://sleepercdn.com/content/nfl/players/4177.jpg
4179	QB	NE	t	2025-11-13 16:40:13.23363	4179	Joshua Dobbs	t	\N	Joshua	Dobbs	Active	\N	0	11	2025-11-13 16:40:13.23363	3044720	https://sleepercdn.com/content/nfl/players/4179.jpg
4233	K	ATL	t	2025-11-13 16:40:13.264144	4233	Zane Gonzalez	t	\N	Zane	Gonzalez	Active	\N	0	45	2025-11-13 16:40:13.264144	3043234	https://sleepercdn.com/content/nfl/players/4233.jpg
4381	TE	NO	t	2025-11-13 16:40:13.271035	4381	Taysom Hill	t	\N	Taysom	Hill	Active	\N	0	7	2025-11-13 16:40:13.271035	2468609	https://sleepercdn.com/content/nfl/players/4381.jpg
4464	QB	JAX	t	2025-11-13 16:40:13.276872	4464	Nick Mullens	t	\N	Nick	Mullens	Active	\N	0	14	2025-11-13 16:40:13.276872	3059989	https://sleepercdn.com/content/nfl/players/4464.jpg
4943	QB	SEA	t	2025-11-13 16:40:13.306004	4943	Sam Darnold	t	\N	Sam	Darnold	Active	\N	0	14	2025-11-13 16:40:13.306004	3912547	https://sleepercdn.com/content/nfl/players/4943.jpg
5010	TE	LAC	t	2025-11-13 16:40:13.35884	5010	Will Dissly	t	\N	Will	Dissly	Active	\N	0	89	2025-11-13 16:40:13.35884	3127292	https://sleepercdn.com/content/nfl/players/5010.jpg
5095	K	LV	t	2025-11-13 16:40:13.387165	5095	Daniel Carlson	t	\N	Daniel	Carlson	Active	\N	0	8	2025-11-13 16:40:13.387165	3051909	https://sleepercdn.com/content/nfl/players/5095.jpg
5119	K	MIA	t	2025-11-13 16:40:13.393022	5119	Jason Sanders	t	\N	Jason	Sanders	Inactive	IR	0	7	2025-11-13 16:40:13.393022	3124679	https://sleepercdn.com/content/nfl/players/5119.jpg
5854	QB	SEA	t	2025-11-13 16:40:13.446288	5854	Drew Lock	t	\N	Drew	Lock	Active	\N	0	2	2025-11-13 16:40:13.446288	3924327	https://sleepercdn.com/content/nfl/players/5854.jpg
5857	TE	CIN	t	2025-11-13 16:40:13.452285	5857	Noah Fant	t	\N	Noah	Fant	Active	\N	0	86	2025-11-13 16:40:13.452285	4036131	https://sleepercdn.com/content/nfl/players/5857.jpg
5872	WR	WAS	t	2025-11-13 16:40:13.468756	5872	Deebo Samuel	t	\N	Deebo	Samuel	Active	\N	0	1	2025-11-13 16:40:13.468756	3126486	https://sleepercdn.com/content/nfl/players/5872.jpg
5967	RB	TEN	t	2025-11-13 16:40:13.486614	5967	Tony Pollard	t	\N	Tony	Pollard	Active	\N	0	20	2025-11-13 16:40:13.486614	3916148	https://sleepercdn.com/content/nfl/players/5967.jpg
5973	TE	MIN	t	2025-11-11 23:14:18.388855	5973	Josh Oliver	t	\N	Josh	Oliver	Active	Questionable	0	84	2025-11-13 16:40:13.502064	3921690	https://sleepercdn.com/content/nfl/players/5973.jpg
5985	TE	NO	t	2025-11-13 16:40:13.510351	5985	Foster Moreau	t	\N	Foster	Moreau	Active	\N	0	87	2025-11-13 16:40:13.510351	3843945	https://sleepercdn.com/content/nfl/players/5985.jpg
PHI	DEF	PHI	t	2025-11-11 23:14:18.953658	PHI	Philadelphia Eagles	t	\N	Philadelphia	Eagles	Active	\N	0	\N	2025-11-13 16:40:14.89845	\N	https://sleepercdn.com/images/team_logos/nfl/phi.png
5230	K	IND	t	2025-11-13 16:40:13.40988	5230	Michael Badgley	t	\N	Michael	Badgley	Active	\N	0	12	2025-11-13 16:40:13.40988	3123052	https://sleepercdn.com/content/nfl/players/5230.jpg
6783	WR	CLE	t	2025-11-13 16:40:13.588531	6783	Jerry Jeudy	t	\N	Jerry	Jeudy	Active	\N	0	3	2025-11-13 16:40:13.588531	4241463	https://sleepercdn.com/content/nfl/players/6783.jpg
6786	WR	DAL	t	2025-11-13 16:40:13.593952	6786	CeeDee Lamb	t	\N	CeeDee	Lamb	Active	\N	0	88	2025-11-13 16:40:13.593952	4241389	https://sleepercdn.com/content/nfl/players/6786.jpg
6801	WR	CIN	t	2025-11-13 16:40:13.616406	6801	Tee Higgins	t	\N	Tee	Higgins	Active	\N	0	5	2025-11-13 16:40:13.616406	4239993	https://sleepercdn.com/content/nfl/players/6801.jpg
6813	RB	IND	t	2025-11-13 16:40:13.632761	6813	Jonathan Taylor	t	\N	Jonathan	Taylor	Active	\N	0	28	2025-11-13 16:40:13.632761	4242335	https://sleepercdn.com/content/nfl/players/6813.jpg
6960	WR	NYJ	t	2025-11-13 16:40:13.66755	6960	Tyler Johnson	t	\N	Tyler	Johnson	Active	\N	0	16	2025-11-13 16:40:13.66755	2310331	https://sleepercdn.com/content/nfl/players/6960.jpg
7002	TE	NO	t	2025-11-13 16:40:13.673127	7002	Juwan Johnson	t	\N	Juwan	Johnson	Active	\N	0	83	2025-11-13 16:40:13.673127	3929645	https://sleepercdn.com/content/nfl/players/7002.jpg
7021	RB	CAR	t	2025-11-13 16:40:13.678856	7021	Rico Dowdle	t	\N	Rico	Dowdle	Active	Questionable	0	5	2025-11-13 16:40:13.678856	4038815	https://sleepercdn.com/content/nfl/players/7021.jpg
7090	WR	ATL	t	2025-11-13 16:40:13.702005	7090	Darnell Mooney	t	\N	Darnell	Mooney	Active	\N	0	1	2025-11-13 16:40:13.702005	4040655	https://sleepercdn.com/content/nfl/players/7090.jpg
7525	WR	PHI	t	2025-11-11 23:14:18.500913	7525	DeVonta Smith	t	\N	DeVonta	Smith	Active	\N	0	6	2025-11-13 16:40:13.714735	4241478	https://sleepercdn.com/content/nfl/players/7525.jpg
9480	TE	JAX	t	2025-11-13 16:40:14.130363	9480	Brenton Strange	t	\N	Brenton	Strange	Inactive	IR	0	85	2025-11-13 16:40:14.130363	4430539	https://sleepercdn.com/content/nfl/players/9480.jpg
9228	QB	CAR	t	2025-11-13 16:40:14.11435	9228	Bryce Young	t	\N	Bryce	Young	Active	\N	0	9	2025-11-13 16:40:14.11435	4685720	https://sleepercdn.com/content/nfl/players/9228.jpg
8210	TE	TEN	t	2025-11-13 16:40:14.027943	8210	Chig Okonkwo	t	\N	Chig	Okonkwo	Active	Questionable	0	85	2025-11-13 16:40:14.027943	4360635	https://sleepercdn.com/content/nfl/players/8210.jpg
8144	WR	NO	t	2025-11-13 16:40:13.94154	8144	Chris Olave	t	\N	Chris	Olave	Active	\N	0	12	2025-11-13 16:40:13.94154	4361370	https://sleepercdn.com/content/nfl/players/8144.jpg
8112	WR	ATL	t	2025-11-13 16:40:13.866444	8112	Drake London	t	\N	Drake	London	Active	Questionable	0	5	2025-11-13 16:40:13.866444	4426502	https://sleepercdn.com/content/nfl/players/8112.jpg
7543	RB	JAX	t	2025-11-13 16:40:13.742577	7543	Travis Etienne	t	\N	Travis	Etienne	Active	\N	0	1	2025-11-13 16:40:13.742577	4239996	https://sleepercdn.com/content/nfl/players/7543.jpg
8489	TE	IND	t	2025-11-13 16:40:14.063229	8489	Drew Ogletree	t	\N	Drew	Ogletree	Active	\N	0	85	2025-11-13 16:40:14.063229	4722908	https://sleepercdn.com/content/nfl/players/8489.jpg
8698	TE	SF	t	2025-11-13 16:40:14.080012	8698	Jake Tonges	t	\N	Jake	Tonges	Active	\N	0	88	2025-11-13 16:40:14.080012	4259147	https://sleepercdn.com/content/nfl/players/8698.jpg
9488	WR	SEA	t	2025-11-13 16:40:14.15195	9488	Jaxon Smith-Njigba	t	\N	Jaxon	Smith-Njigba	Active	\N	0	11	2025-11-13 16:40:14.15195	4430878	https://sleepercdn.com/content/nfl/players/9488.jpg
10444	WR	CLE	t	2025-11-13 16:40:14.261802	10444	Cedric Tillman	t	\N	Cedric	Tillman	Active	Questionable	0	19	2025-11-13 16:40:14.261802	7351	https://sleepercdn.com/content/nfl/players/10444.jpg
8145	TE	NYJ	t	2025-11-13 16:40:13.946927	8145	Jeremy Ruckert	t	\N	Jeremy	Ruckert	Active	\N	0	89	2025-11-13 16:40:13.946927	4361372	https://sleepercdn.com/content/nfl/players/8145.jpg
8143	RB	CLE	t	2025-11-13 16:40:13.935978	8143	Jerome Ford	t	\N	Jerome	Ford	Active	\N	0	34	2025-11-13 16:40:13.935978	4372019	https://sleepercdn.com/content/nfl/players/8143.jpg
7716	TE	WAS	t	2025-11-13 16:40:13.817349	7716	John Bates	t	\N	John	Bates	Active	\N	0	87	2025-11-13 16:40:13.817349	4048228	https://sleepercdn.com/content/nfl/players/7716.jpg
9229	QB	IND	t	2025-11-13 16:40:14.119968	9229	Anthony Richardson	t	\N	Anthony	Richardson	Inactive	IR	0	5	2025-11-13 16:40:14.119968	4429084	https://sleepercdn.com/content/nfl/players/9229.jpg
7527	QB	SF	t	2025-11-13 16:40:13.72599	7527	Mac Jones	t	\N	Mac	Jones	Active	\N	0	10	2025-11-13 16:40:13.72599	4241464	https://sleepercdn.com/content/nfl/players/7527.jpg
9482	TE	LV	t	2025-11-13 16:40:14.141133	9482	Michael Mayer	t	\N	Michael	Mayer	Active	\N	0	87	2025-11-13 16:40:14.141133	4429086	https://sleepercdn.com/content/nfl/players/9482.jpg
7922	K	MIA	t	2025-11-13 16:40:13.839837	7922	Riley Patterson	t	\N	Riley	Patterson	Active	\N	0	47	2025-11-13 16:40:13.839837	4243371	https://sleepercdn.com/content/nfl/players/7922.jpg
7526	WR	MIA	t	2025-11-13 16:40:13.720362	7526	Jaylen Waddle	t	\N	Jaylen	Waddle	Active	\N	0	17	2025-11-13 16:40:13.720362	4372016	https://sleepercdn.com/content/nfl/players/7526.jpg
7523	QB	JAX	t	2025-11-13 16:40:13.707409	7523	Trevor Lawrence	t	\N	Trevor	Lawrence	Active	\N	0	16	2025-11-13 16:40:13.707409	4360310	https://sleepercdn.com/content/nfl/players/7523.jpg
8183	QB	SF	t	2025-11-13 16:40:14.008048	8183	Brock Purdy	t	\N	Brock	Purdy	Active	Questionable	0	13	2025-11-13 16:40:14.008048	4361741	https://sleepercdn.com/content/nfl/players/8183.jpg
7828	TE	KC	t	2025-11-11 23:14:18.556462	7828	Noah Gray	t	\N	Noah	Gray	Active	\N	0	83	2025-11-13 16:40:13.822981	4240472	https://sleepercdn.com/content/nfl/players/7828.jpg
6528	K	TEN	t	2025-11-13 16:40:13.571934	6528	Joey Slye	t	\N	Joey	Slye	Active	\N	0	6	2025-11-13 16:40:13.571934	3124084	https://sleepercdn.com/content/nfl/players/6528.jpg
8136	RB	TB	t	2025-11-11 23:14:18.600359	8136	Rachaad White	t	\N	Rachaad	White	Active	\N	0	1	2025-11-13 16:40:13.919229	4697815	https://sleepercdn.com/content/nfl/players/8136.jpg
8204	WR	GB	t	2025-11-11 23:14:18.645368	8204	Bo Melton	t	\N	Bo	Melton	Active	\N	0	16	2025-11-13 16:40:14.016742	4259305	https://sleepercdn.com/content/nfl/players/8204.jpg
9230	QB	PHI	t	2025-11-11 23:14:18.704284	9230	Tanner McKee	t	\N	Tanner	McKee	Active	\N	0	16	2025-11-13 16:40:14.125118	4685201	https://sleepercdn.com/content/nfl/players/9230.jpg
10227	TE	TB	t	2025-11-11 23:14:18.747866	10227	Payne Durham	t	\N	Payne	Durham	Active	\N	0	87	2025-11-13 16:40:14.239035	4372505	https://sleepercdn.com/content/nfl/players/10227.jpg
11637	WR	BUF	t	2025-11-11 23:14:18.812092	11637	Keon Coleman	t	\N	Keon	Coleman	Active	\N	0	\N	2025-11-13 16:40:14.46361	4635008	https://sleepercdn.com/content/nfl/players/11637.jpg
12015	K	LAR	t	2025-11-11 23:14:18.837838	12015	Harrison Mevis	t	\N	Harrison	Mevis	Active	\N	0	92	2025-11-13 16:40:14.516453	4574716	https://sleepercdn.com/content/nfl/players/12015.jpg
12658	TE	BUF	t	2025-11-11 23:14:18.878777	12658	Jackson Hawes	t	\N	Jackson	Hawes	Active	\N	0	85	2025-11-13 16:40:14.72048	4573699	https://sleepercdn.com/content/nfl/players/12658.jpg
PIT	DEF	PIT	t	2025-11-11 23:14:18.910219	PIT	Pittsburgh Steelers	t	\N	Pittsburgh	Steelers	Active	\N	0	\N	2025-11-13 16:40:14.773971	\N	https://sleepercdn.com/images/team_logos/nfl/pit.png
LAR	DEF	LAR	t	2025-11-11 23:14:18.928223	LAR	Los Angeles Rams	t	\N	Los Angeles	Rams	Active	\N	0	\N	2025-11-13 16:40:14.858659	\N	https://sleepercdn.com/images/team_logos/nfl/lar.png
6130	RB	NYG	t	2025-11-13 16:40:13.546527	6130	Devin Singletary	t	\N	Devin	Singletary	Active	\N	0	26	2025-11-13 16:40:13.546527	4040761	https://sleepercdn.com/content/nfl/players/6130.jpg
11604	TE	LV	t	2025-11-13 16:40:14.413738	11604	Brock Bowers	t	\N	Brock	Bowers	Active	\N	0	89	2025-11-13 16:40:14.413738	4432665	https://sleepercdn.com/content/nfl/players/11604.jpg
11655	RB	NYG	t	2025-11-13 16:40:14.491926	11655	Tyrone Tracy Jr.	t	\N	Tyrone	Tracy	Active	\N	0	29	2025-11-13 16:40:14.491926	4360516	https://sleepercdn.com/content/nfl/players/11655.jpg
12522	QB	TEN	t	2025-11-13 16:40:14.667813	12522	Cam Ward	t	\N	Cam	Ward	Active	\N	0	1	2025-11-13 16:40:14.667813	4688380	https://sleepercdn.com/content/nfl/players/12522.jpg
11557	QB	DAL	t	2025-11-13 16:40:14.351764	11557	Joe Milton	t	\N	Joe	Milton	Active	\N	0	10	2025-11-13 16:40:14.351764	4360698	https://sleepercdn.com/content/nfl/players/11557.jpg
11653	K	NO	t	2025-11-13 16:40:14.486199	11653	Charlie Smyth	t	\N	Charlie	Smyth	Active	\N	0	39	2025-11-13 16:40:14.486199	5208518	https://sleepercdn.com/content/nfl/players/11653.jpg
12517	TE	CHI	t	2025-11-13 16:40:14.650482	12517	Colston Loveland	t	\N	Colston	Loveland	Active	\N	0	84	2025-11-13 16:40:14.650482	4723086	https://sleepercdn.com/content/nfl/players/12517.jpg
12471	RB	IND	t	2025-11-13 16:40:14.552176	12471	DJ Giddens	t	\N	DJ	Giddens	Active	Out	0	21	2025-11-13 16:40:14.552176	4874509	https://sleepercdn.com/content/nfl/players/12471.jpg
12506	TE	CLE	t	2025-11-13 16:40:14.626773	12506	Harold Fannin	t	\N	Harold	Fannin	Active	Questionable	0	44	2025-11-13 16:40:14.626773	5083076	https://sleepercdn.com/content/nfl/players/12506.jpg
10937	K	CHI	t	2025-11-13 16:40:14.288192	10937	Jake Moody	t	\N	Jake	Moody	Active	\N	0	16	2025-11-13 16:40:14.288192	4372066	https://sleepercdn.com/content/nfl/players/10937.jpg
11600	TE	CAR	t	2025-11-13 16:40:14.402482	11600	Ja'Tavion Sanders	t	\N	Ja'Tavion	Sanders	Active	\N	0	\N	2025-11-13 16:40:14.402482	4431588	https://sleepercdn.com/content/nfl/players/11600.jpg
12457	RB	DAL	t	2025-11-13 16:40:14.546035	12457	Jaydon Blue	t	\N	Jaydon	Blue	Active	\N	0	23	2025-11-13 16:40:14.546035	4685279	https://sleepercdn.com/content/nfl/players/12457.jpg
11648	QB	ARI	t	2025-11-13 16:40:14.480012	11648	Kedon Slovis	t	\N	Kedon	Slovis	Active	\N	0	19	2025-11-13 16:40:14.480012	4428512	https://sleepercdn.com/content/nfl/players/11648.jpg
10232	WR	ARI	t	2025-11-13 16:40:14.256246	10232	Michael Wilson	t	\N	Michael	Wilson	Active	\N	0	14	2025-11-13 16:40:14.256246	4360761	https://sleepercdn.com/content/nfl/players/10232.jpg
11620	WR	CHI	t	2025-11-13 16:40:14.42482	11620	Rome Odunze	t	\N	Rome	Odunze	Active	Questionable	0	15	2025-11-13 16:40:14.42482	4431299	https://sleepercdn.com/content/nfl/players/11620.jpg
12524	QB	CLE	t	2025-11-13 16:40:14.6741	12524	Shedeur Sanders	t	\N	Shedeur	Sanders	Active	\N	0	12	2025-11-13 16:40:14.6741	4432762	https://sleepercdn.com/content/nfl/players/12524.jpg
11597	TE	NYG	t	2025-11-13 16:40:14.396878	11597	Theo Johnson	t	\N	Theo	Johnson	Active	\N	0	84	2025-11-13 16:40:14.396878	4429148	https://sleepercdn.com/content/nfl/players/11597.jpg
10219	RB	WAS	t	2025-11-13 16:40:14.233564	10219	Chris Rodriguez	t	\N	Chris	Rodriguez	Active	\N	0	36	2025-11-13 16:40:14.233564	4362619	https://sleepercdn.com/content/nfl/players/10219.jpg
12545	QB	NO	t	2025-11-13 16:40:14.708148	12545	Tyler Shough	t	\N	Tyler	Shough	Active	\N	0	6	2025-11-13 16:40:14.708148	4360689	https://sleepercdn.com/content/nfl/players/12545.jpg
11256	QB	CHI	t	2025-11-13 16:40:14.310861	11256	Tyson Bagent	t	\N	Tyson	Bagent	Active	\N	0	17	2025-11-13 16:40:14.310861	4434153	https://sleepercdn.com/content/nfl/players/11256.jpg
9753	RB	SEA	t	2025-11-13 16:40:14.186224	9753	Zach Charbonnet	t	\N	Zach	Charbonnet	Active	\N	0	26	2025-11-13 16:40:14.186224	4426385	https://sleepercdn.com/content/nfl/players/9753.jpg
11610	WR	MIA	t	2025-11-13 16:40:14.419336	11610	Malik Washington	t	\N	Malik	Washington	Active	\N	0	6	2025-11-13 16:40:14.419336	4569603	https://sleepercdn.com/content/nfl/players/11610.jpg
12495	RB	MIA	t	2025-11-13 16:40:14.602291	12495	Ollie Gordon	t	\N	Ollie	Gordon	Active	Questionable	0	31	2025-11-13 16:40:14.602291	4711533	https://sleepercdn.com/content/nfl/players/12495.jpg
10231	TE	ARI	t	2025-11-13 16:40:14.250643	10231	Elijah Higgins	t	\N	Elijah	Higgins	Active	\N	0	84	2025-11-13 16:40:14.250643	4426844	https://sleepercdn.com/content/nfl/players/10231.jpg
12527	RB	LV	t	2025-11-13 16:40:14.685648	12527	Ashton Jeanty	t	\N	Ashton	Jeanty	Active	\N	0	2	2025-11-13 16:40:14.685648	4890973	https://sleepercdn.com/content/nfl/players/12527.jpg
6083	K	WAS	t	2025-11-13 16:40:13.534835	6083	Matt Gay	t	\N	Matt	Gay	Active	\N	0	16	2025-11-13 16:40:13.534835	7757	https://sleepercdn.com/content/nfl/players/6083.jpg
17	K	BUF	t	2025-11-11 23:14:18.101431	17	Matt Prater	t	\N	Matt	Prater	Active	\N	0	15	2025-11-13 16:40:12.933019	11122	https://sleepercdn.com/content/nfl/players/17.jpg
503	K	NYG	t	2025-11-13 16:40:12.970211	503	Graham Gano	t	\N	Graham	Gano	Inactive	IR	0	9	2025-11-13 16:40:12.970211	12460	https://sleepercdn.com/content/nfl/players/503.jpg
1166	QB	ATL	t	2025-11-13 16:40:12.996893	1166	Kirk Cousins	t	\N	Kirk	Cousins	Active	\N	0	18	2025-11-13 16:40:12.996893	14880	https://sleepercdn.com/content/nfl/players/1166.jpg
1426	WR	BAL	t	2025-11-13 16:40:13.015035	1426	DeAndre Hopkins	t	\N	DeAndre	Hopkins	Active	\N	0	10	2025-11-13 16:40:13.015035	15795	https://sleepercdn.com/content/nfl/players/1426.jpg
2306	QB	NYG	t	2025-11-13 16:40:13.073525	2306	Jameis Winston	t	\N	Jameis	Winston	Active	\N	0	19	2025-11-13 16:40:13.073525	2969939	https://sleepercdn.com/content/nfl/players/2306.jpg
2449	WR	NE	t	2025-11-13 16:40:13.091934	2449	Stefon Diggs	t	\N	Stefon	Diggs	Active	\N	0	8	2025-11-13 16:40:13.091934	2976212	https://sleepercdn.com/content/nfl/players/2449.jpg
3202	TE	NE	t	2025-11-13 16:40:13.12272	3202	Austin Hooper	t	\N	Austin	Hooper	Active	Out	0	81	2025-11-13 16:40:13.12272	3043275	https://sleepercdn.com/content/nfl/players/3202.jpg
3294	QB	DAL	t	2025-11-13 16:40:13.150461	3294	Dak Prescott	t	\N	Dak	Prescott	Active	\N	0	4	2025-11-13 16:40:13.150461	2577417	https://sleepercdn.com/content/nfl/players/3294.jpg
4033	TE	CLE	t	2025-11-13 16:40:13.179144	4033	David Njoku	t	\N	David	Njoku	Active	\N	0	85	2025-11-13 16:40:13.179144	3123076	https://sleepercdn.com/content/nfl/players/4033.jpg
4147	RB	CIN	t	2025-11-13 16:40:13.220425	4147	Samaje Perine	t	\N	Samaje	Perine	Active	Questionable	0	34	2025-11-13 16:40:13.220425	3116389	https://sleepercdn.com/content/nfl/players/4147.jpg
4217	TE	SF	t	2025-11-13 16:40:13.252822	4217	George Kittle	t	\N	George	Kittle	Active	\N	0	85	2025-11-13 16:40:13.252822	3040151	https://sleepercdn.com/content/nfl/players/4217.jpg
4666	K	NYG	t	2025-11-13 16:40:13.282171	4666	Younghoe Koo	t	\N	Younghoe	Koo	Active	\N	0	37	2025-11-13 16:40:13.282171	3049899	https://sleepercdn.com/content/nfl/players/4666.jpg
4981	WR	TEN	t	2025-11-13 16:40:13.322751	4981	Calvin Ridley	t	\N	Calvin	Ridley	Active	Questionable	0	\N	2025-11-13 16:40:13.322751	3925357	https://sleepercdn.com/content/nfl/players/4981.jpg
5189	K	SF	t	2025-11-13 16:40:13.404035	5189	Eddy Pineiro	t	\N	Eddy	Pineiro	Active	\N	0	18	2025-11-13 16:40:13.404035	4034949	https://sleepercdn.com/content/nfl/players/5189.jpg
5870	QB	IND	t	2025-11-13 16:40:13.463386	5870	Daniel Jones	t	\N	Daniel	Jones	Active	\N	0	17	2025-11-13 16:40:13.463386	3917792	https://sleepercdn.com/content/nfl/players/5870.jpg
5970	WR	ARI	t	2025-11-13 16:40:13.494102	5970	Greg Dortch	t	\N	Greg	Dortch	Active	\N	0	4	2025-11-13 16:40:13.494102	4037235	https://sleepercdn.com/content/nfl/players/5970.jpg
IND	DEF	IND	t	2025-11-13 16:40:14.781895	IND	Indianapolis Colts	t	\N	Indianapolis	Colts	Active	\N	0	\N	2025-11-13 16:40:14.781895	\N	https://sleepercdn.com/images/team_logos/nfl/ind.png
ARI	DEF	ARI	t	2025-11-13 16:40:14.789953	ARI	Arizona Cardinals	t	\N	Arizona	Cardinals	Active	\N	0	\N	2025-11-13 16:40:14.789953	\N	https://sleepercdn.com/images/team_logos/nfl/ari.png
LV	DEF	LV	t	2025-11-13 16:40:14.801414	LV	Las Vegas Raiders	t	\N	Las Vegas	Raiders	Active	\N	0	\N	2025-11-13 16:40:14.801414	\N	https://sleepercdn.com/images/team_logos/nfl/lv.png
NYJ	DEF	NYJ	t	2025-11-13 16:40:14.806863	NYJ	New York Jets	t	\N	New York	Jets	Active	\N	0	\N	2025-11-13 16:40:14.806863	\N	https://sleepercdn.com/images/team_logos/nfl/nyj.png
11533	K	DAL	t	2025-11-13 16:40:14.339898	11533	Brandon Aubrey	t	\N	Brandon	Aubrey	Active	\N	0	17	2025-11-13 16:40:14.339898	3953687	https://sleepercdn.com/content/nfl/players/11533.jpg
CLE	DEF	CLE	t	2025-11-13 16:40:14.834637	CLE	Cleveland Browns	t	\N	Cleveland	Browns	Active	\N	0	\N	2025-11-13 16:40:14.834637	\N	https://sleepercdn.com/images/team_logos/nfl/cle.png
CAR	DEF	CAR	t	2025-11-13 16:40:14.846766	CAR	Carolina Panthers	t	\N	Carolina	Panthers	Active	\N	0	\N	2025-11-13 16:40:14.846766	\N	https://sleepercdn.com/images/team_logos/nfl/car.png
JAX	DEF	JAX	t	2025-11-13 16:40:14.85241	JAX	Jacksonville Jaguars	t	\N	Jacksonville	Jaguars	Active	\N	0	\N	2025-11-13 16:40:14.85241	\N	https://sleepercdn.com/images/team_logos/nfl/jax.png
MIA	DEF	MIA	t	2025-11-13 16:40:14.8803	MIA	Miami Dolphins	t	\N	Miami	Dolphins	Active	\N	0	\N	2025-11-13 16:40:14.8803	\N	https://sleepercdn.com/images/team_logos/nfl/mia.png
SF	DEF	SF	t	2025-11-13 16:40:14.904196	SF	San Francisco 49ers	t	\N	San Francisco	49ers	Active	\N	0	\N	2025-11-13 16:40:14.904196	\N	https://sleepercdn.com/images/team_logos/nfl/sf.png
TEN	DEF	TEN	t	2025-11-13 16:40:14.915474	TEN	Tennessee Titans	t	\N	Tennessee	Titans	Active	\N	0	\N	2025-11-13 16:40:14.915474	\N	https://sleepercdn.com/images/team_logos/nfl/ten.png
CHI	DEF	CHI	t	2025-11-13 16:40:14.921564	CHI	Chicago Bears	t	\N	Chicago	Bears	Active	\N	0	\N	2025-11-13 16:40:14.921564	\N	https://sleepercdn.com/images/team_logos/nfl/chi.png
KC	DEF	KC	t	2025-11-11 23:14:18.965673	KC	Kansas City Chiefs	t	\N	Kansas City	Chiefs	Active	\N	0	\N	2025-11-13 16:40:14.941376	\N	https://sleepercdn.com/images/team_logos/nfl/kc.png
12529	RB	NE	t	2025-11-13 16:40:14.691464	12529	TreVeyon Henderson	t	\N	TreVeyon	Henderson	Active	\N	0	32	2025-11-13 16:40:14.691464	4432710	https://sleepercdn.com/content/nfl/players/12529.jpg
12533	RB	WAS	t	2025-11-13 16:40:14.696852	12533	Jacory Croskey-Merritt	t	\N	Jacory	Croskey-Merritt	Active	\N	0	22	2025-11-13 16:40:14.696852	4575131	https://sleepercdn.com/content/nfl/players/12533.jpg
8500	TE	GB	t	2025-11-11 23:14:18.679525	8500	John FitzPatrick	t	\N	John	FitzPatrick	Active	\N	0	86	2025-11-13 16:40:14.068761	4379401	https://sleepercdn.com/content/nfl/players/8500.jpg
11560	QB	CHI	t	2025-11-13 16:40:14.362724	11560	Caleb Williams	t	\N	Caleb	Williams	Active	\N	0	18	2025-11-13 16:40:14.362724	4431611	https://sleepercdn.com/content/nfl/players/11560.jpg
11603	TE	SEA	t	2025-11-13 16:40:14.408364	11603	AJ Barner	t	\N	AJ	Barner	Active	\N	0	88	2025-11-13 16:40:14.408364	4576297	https://sleepercdn.com/content/nfl/players/11603.jpg
10955	K	ARI	t	2025-11-13 16:40:14.294274	10955	Chad Ryland	t	\N	Chad	Ryland	Active	\N	0	38	2025-11-13 16:40:14.294274	4363538	https://sleepercdn.com/content/nfl/players/10955.jpg
8137	WR	DAL	t	2025-11-13 16:40:13.924575	8137	George Pickens	t	\N	George	Pickens	Active	\N	0	3	2025-11-13 16:40:13.924575	4426354	https://sleepercdn.com/content/nfl/players/8137.jpg
12548	K	ATL	t	2025-11-13 16:40:14.714463	12548	Lenny Krieg	t	\N	Lenny	Krieg	Active	\N	0	46	2025-11-13 16:40:14.714463	5277116	https://sleepercdn.com/content/nfl/players/12548.jpg
10871	TE	DAL	t	2025-11-13 16:40:14.281066	10871	Luke Schoonmaker	t	\N	Luke	Schoonmaker	Active	\N	0	86	2025-11-13 16:40:14.281066	4372096	https://sleepercdn.com/content/nfl/players/10871.jpg
11564	QB	NE	t	2025-11-13 16:40:14.374181	11564	Drake Maye	t	\N	Drake	Maye	Active	\N	0	10	2025-11-13 16:40:14.374181	4431452	https://sleepercdn.com/content/nfl/players/11564.jpg
11565	QB	MIN	t	2025-11-11 23:14:18.783148	11565	J.J. McCarthy	t	\N	J.J.	McCarthy	Active	Questionable	0	9	2025-11-13 16:40:14.37944	4433970	https://sleepercdn.com/content/nfl/players/11565.jpg
11586	RB	LAR	t	2025-11-11 23:14:18.789148	11586	Blake Corum	t	\N	Blake	Corum	Active	\N	0	22	2025-11-13 16:40:14.39149	4429096	https://sleepercdn.com/content/nfl/players/11586.jpg
11624	WR	KC	t	2025-11-11 23:14:18.794752	11624	Xavier Worthy	t	\N	Xavier	Worthy	Active	\N	0	1	2025-11-13 16:40:14.43035	4683062	https://sleepercdn.com/content/nfl/players/11624.jpg
11626	WR	CAR	t	2025-11-13 16:40:14.441246	11626	Xavier Legette	t	\N	Xavier	Legette	Active	\N	0	17	2025-11-13 16:40:14.441246	4430034	https://sleepercdn.com/content/nfl/players/11626.jpg
11635	WR	LAC	t	2025-11-11 23:14:18.806419	11635	Ladd McConkey	t	\N	Ladd	McConkey	Active	Questionable	0	15	2025-11-13 16:40:14.457997	4612826	https://sleepercdn.com/content/nfl/players/11635.jpg
11647	RB	LAC	t	2025-11-11 23:14:18.817907	11647	Kimani Vidal	t	\N	Kimani	Vidal	Active	\N	0	30	2025-11-13 16:40:14.47451	4430968	https://sleepercdn.com/content/nfl/players/11647.jpg
12185	K	IND	t	2025-11-13 16:40:14.523291	12185	Spencer Shrader	t	\N	Spencer	Shrader	Inactive	IR	0	3	2025-11-13 16:40:14.523291	4571557	https://sleepercdn.com/content/nfl/players/12185.jpg
12385	K	NYG	t	2025-11-13 16:40:14.530668	12385	Jude McAtamney	t	\N	Jude	McAtamney	Active	\N	0	99	2025-11-13 16:40:14.530668	5092436	https://sleepercdn.com/content/nfl/players/12385.jpg
12486	QB	CLE	t	2025-11-13 16:40:14.571467	12486	Dillon Gabriel	t	\N	Dillon	Gabriel	Active	\N	0	8	2025-11-13 16:40:14.571467	4427238	https://sleepercdn.com/content/nfl/players/12486.jpg
12489	RB	DEN	t	2025-11-11 23:14:18.860686	12489	RJ Harvey	t	\N	RJ	Harvey	Active	\N	0	12	2025-11-13 16:40:14.577815	4568490	https://sleepercdn.com/content/nfl/players/12489.jpg
12493	TE	LAC	t	2025-11-11 23:14:18.866416	12493	Oronde Gadsden	t	\N	Oronde	Gadsden	Active	\N	0	86	2025-11-13 16:40:14.591847	1070	https://sleepercdn.com/content/nfl/players/12493.jpg
12498	TE	NYJ	t	2025-11-13 16:40:14.609162	12498	Mason Taylor	t	\N	Mason	Taylor	Active	\N	0	85	2025-11-13 16:40:14.609162	4808766	https://sleepercdn.com/content/nfl/players/12498.jpg
BUF	DEF	BUF	t	2025-11-11 23:14:18.947118	BUF	Buffalo Bills	t	\N	Buffalo	Bills	Active	\N	0	\N	2025-11-13 16:40:14.892693	\N	https://sleepercdn.com/images/team_logos/nfl/buf.png
11435	RB	GB	t	2025-11-11 23:14:18.76584	11435	Emanuel Wilson	t	\N	Emanuel	Wilson	Active	\N	0	23	2025-11-13 16:40:14.332184	4887558	https://sleepercdn.com/content/nfl/players/11435.jpg
6111	QB	CIN	t	2025-11-13 16:40:13.540469	6111	Jake Browning	t	\N	Jake	Browning	Active	\N	0	6	2025-11-13 16:40:13.540469	3886812	https://sleepercdn.com/content/nfl/players/6111.jpg
6149	WR	NYG	t	2025-11-13 16:40:13.559132	6149	Darius Slayton	t	\N	Darius	Slayton	Active	Questionable	0	18	2025-11-13 16:40:13.559132	3916945	https://sleepercdn.com/content/nfl/players/6149.jpg
6790	RB	CHI	t	2025-11-13 16:40:13.599498	6790	D'Andre Swift	t	\N	D'Andre	Swift	Active	Questionable	0	4	2025-11-13 16:40:13.599498	4259545	https://sleepercdn.com/content/nfl/players/6790.jpg
11199	RB	ARI	t	2025-11-13 16:40:14.30534	11199	Emari Demercado	t	\N	Emari	Demercado	Active	\N	0	31	2025-11-13 16:40:14.30534	4362478	https://sleepercdn.com/content/nfl/players/11199.jpg
12775	QB	MIN	t	2025-11-11 23:14:18.891926	12775	Max Brosmer	t	\N	Max	Brosmer	Active	\N	0	12	2025-11-13 16:40:14.738089	4573398	https://sleepercdn.com/content/nfl/players/12775.jpg
13066	K	NYG	t	2025-11-13 16:40:14.749304	13066	Ben Sauls	t	\N	Ben	Sauls	Active	\N	0	30	2025-11-13 16:40:14.749304	4566158	https://sleepercdn.com/content/nfl/players/13066.jpg
5133	TE	LAC	t	2025-11-11 23:14:18.3461	5133	Tyler Conklin	t	\N	Tyler	Conklin	Active	\N	0	83	2025-11-11 23:14:18.3461	3915486	https://sleepercdn.com/content/nfl/players/5133.jpg
6819	WR	IND	t	2025-11-13 16:40:13.638172	6819	Michael Pittman	t	\N	Michael	Pittman	Active	\N	0	11	2025-11-13 16:40:13.638172	1497	https://sleepercdn.com/content/nfl/players/6819.jpg
7535	TE	JAX	t	2025-11-13 16:40:13.731679	7535	Hunter Long	t	\N	Hunter	Long	Active	Questionable	0	84	2025-11-13 16:40:13.731679	4239944	https://sleepercdn.com/content/nfl/players/7535.jpg
7547	WR	DET	t	2025-11-11 23:14:18.513994	7547	Amon-Ra St. Brown	t	\N	Amon-Ra	St. Brown	Active	\N	0	14	2025-11-13 16:40:13.747888	4374302	https://sleepercdn.com/content/nfl/players/7547.jpg
7569	WR	HOU	t	2025-11-11 23:14:18.525208	7569	Nico Collins	t	\N	Nico	Collins	Active	\N	0	12	2025-11-13 16:40:13.771599	4258173	https://sleepercdn.com/content/nfl/players/7569.jpg
7585	QB	HOU	t	2025-11-11 23:14:18.537544	7585	Davis Mills	t	\N	Davis	Mills	Active	\N	0	10	2025-11-13 16:40:13.776975	4242546	https://sleepercdn.com/content/nfl/players/7585.jpg
7594	RB	CAR	t	2025-11-13 16:40:13.793985	7594	Chuba Hubbard	t	\N	Chuba	Hubbard	Active	\N	0	30	2025-11-13 16:40:13.793985	4241416	https://sleepercdn.com/content/nfl/players/7594.jpg
7694	TE	CAR	t	2025-11-13 16:40:13.810697	7694	Tommy Tremble	t	\N	Tommy	Tremble	Active	\N	0	82	2025-11-13 16:40:13.810697	4372780	https://sleepercdn.com/content/nfl/players/7694.jpg
7839	K	CIN	t	2025-11-13 16:40:13.828781	7839	Evan McPherson	t	\N	Evan	McPherson	Active	\N	0	2	2025-11-13 16:40:13.828781	4360234	https://sleepercdn.com/content/nfl/players/7839.jpg
8110	TE	DAL	t	2025-11-13 16:40:13.852551	8110	Jake Ferguson	t	\N	Jake	Ferguson	Active	\N	0	87	2025-11-13 16:40:13.852551	4242355	https://sleepercdn.com/content/nfl/players/8110.jpg
8111	TE	TB	t	2025-11-11 23:14:18.568925	8111	Cade Otton	t	\N	Cade	Otton	Active	\N	0	88	2025-11-13 16:40:13.858536	4243331	https://sleepercdn.com/content/nfl/players/8111.jpg
8130	TE	ARI	t	2025-11-13 16:40:13.896177	8130	Trey McBride	t	\N	Trey	McBride	Active	\N	0	85	2025-11-13 16:40:13.896177	4361307	https://sleepercdn.com/content/nfl/players/8130.jpg
8132	RB	ATL	t	2025-11-13 16:40:13.907126	8132	Tyler Allgeier	t	\N	Tyler	Allgeier	Active	\N	0	25	2025-11-13 16:40:13.907126	4373626	https://sleepercdn.com/content/nfl/players/8132.jpg
8148	WR	DET	t	2025-11-11 23:14:18.613105	8148	Jameson Williams	t	\N	Jameson	Williams	Active	\N	0	1	2025-11-13 16:40:13.952256	4426388	https://sleepercdn.com/content/nfl/players/8148.jpg
8151	RB	SEA	t	2025-11-13 16:40:13.963849	8151	Kenneth Walker	t	\N	Kenneth	Walker	Active	\N	0	9	2025-11-13 16:40:13.963849	2971595	https://sleepercdn.com/content/nfl/players/8151.jpg
8160	QB	LV	t	2025-11-13 16:40:13.980357	8160	Kenny Pickett	t	\N	Kenny	Pickett	Active	\N	0	15	2025-11-13 16:40:13.980357	4240703	https://sleepercdn.com/content/nfl/players/8160.jpg
8167	WR	GB	t	2025-11-11 23:14:18.63233	8167	Christian Watson	t	\N	Christian	Watson	Active	\N	0	9	2025-11-13 16:40:13.991151	4248528	https://sleepercdn.com/content/nfl/players/8167.jpg
8228	RB	PIT	t	2025-11-11 23:14:18.659899	8228	Jaylen Warren	t	\N	Jaylen	Warren	Active	\N	0	30	2025-11-13 16:40:14.04522	4569987	https://sleepercdn.com/content/nfl/players/8228.jpg
8408	RB	MIN	t	2025-11-11 23:14:18.672817	8408	Jordan Mason	t	\N	Jordan	Mason	Active	\N	0	27	2025-11-13 16:40:14.057038	4360569	https://sleepercdn.com/content/nfl/players/8408.jpg
8676	WR	SEA	t	2025-11-13 16:40:14.074296	8676	Rashid Shaheed	t	\N	Rashid	Shaheed	Active	\N	0	22	2025-11-13 16:40:14.074296	4032473	https://sleepercdn.com/content/nfl/players/8676.jpg
9221	RB	DET	t	2025-11-11 23:14:18.691573	9221	Jahmyr Gibbs	t	\N	Jahmyr	Gibbs	Active	\N	0	\N	2025-11-13 16:40:14.091645	4429795	https://sleepercdn.com/content/nfl/players/9221.jpg
9493	WR	LAR	t	2025-11-11 23:14:18.718199	9493	Puka Nacua	t	\N	Puka	Nacua	Active	\N	0	12	2025-11-13 16:40:14.157601	4426515	https://sleepercdn.com/content/nfl/players/9493.jpg
9500	WR	IND	t	2025-11-13 16:40:14.163118	9500	Josh Downs	t	\N	Josh	Downs	Active	\N	0	2	2025-11-13 16:40:14.163118	4688813	https://sleepercdn.com/content/nfl/players/9500.jpg
9506	RB	TB	t	2025-11-11 23:14:18.724275	9506	Sean Tucker	t	\N	Sean	Tucker	Active	\N	0	44	2025-11-13 16:40:14.169316	4430871	https://sleepercdn.com/content/nfl/players/9506.jpg
9754	WR	LAC	t	2025-11-13 16:40:14.191649	9754	Quentin Johnston	t	\N	Quentin	Johnston	Active	Questionable	0	1	2025-11-13 16:40:14.191649	4429025	https://sleepercdn.com/content/nfl/players/9754.jpg
9756	WR	MIN	t	2025-11-11 23:14:18.730099	9756	Jordan Addison	t	\N	Jordan	Addison	Active	\N	0	3	2025-11-13 16:40:14.198212	4429205	https://sleepercdn.com/content/nfl/players/9756.jpg
9997	WR	BAL	t	2025-11-11 23:14:18.742074	9997	Zay Flowers	t	\N	Zay	Flowers	Active	\N	0	4	2025-11-13 16:40:14.216775	4429615	https://sleepercdn.com/content/nfl/players/9997.jpg
WAS	DEF	WAS	t	2025-11-13 16:40:14.817932	WAS	Washington Commanders	t	\N	Washington	Commanders	Active	\N	0	\N	2025-11-13 16:40:14.817932	28	https://sleepercdn.com/images/team_logos/nfl/was.png
7049	WR	SF	t	2025-11-13 16:40:13.690002	7049	Jauan Jennings	t	\N	Jauan	Jennings	Active	\N	0	15	2025-11-13 16:40:13.690002	3886598	https://sleepercdn.com/content/nfl/players/7049.jpg
12534	RB	CHI	t	2025-11-13 16:40:14.702451	12534	Kyle Monangai	t	\N	Kyle	Monangai	Active	\N	0	25	2025-11-13 16:40:14.702451	4608686	https://sleepercdn.com/content/nfl/players/12534.jpg
7933	K	CAR	t	2025-11-13 16:40:13.845801	7933	Alex Kessman	t	\N	Alex	Kessman	Active	\N	0	19	2025-11-13 16:40:13.845801	4046164	https://sleepercdn.com/content/nfl/players/7933.jpg
9224	RB	CIN	t	2025-11-13 16:40:14.097194	9224	Chase Brown	t	\N	Chase	Brown	Active	\N	0	30	2025-11-13 16:40:14.097194	4362238	https://sleepercdn.com/content/nfl/players/9224.jpg
8225	TE	NYG	t	2025-11-13 16:40:14.033826	8225	Daniel Bellinger	t	\N	Daniel	Bellinger	Active	Questionable	0	82	2025-11-13 16:40:14.033826	4361516	https://sleepercdn.com/content/nfl/players/8225.jpg
8172	TE	MIA	t	2025-11-13 16:40:13.996565	8172	Greg Dulcich	t	\N	Greg	Dulcich	Active	\N	0	85	2025-11-13 16:40:13.996565	4367209	https://sleepercdn.com/content/nfl/players/8172.jpg
7553	TE	ATL	t	2025-11-13 16:40:13.753366	7553	Kyle Pitts	t	\N	Kyle	Pitts	Active	\N	0	8	2025-11-13 16:40:13.753366	4360248	https://sleepercdn.com/content/nfl/players/7553.jpg
6768	QB	MIA	t	2025-11-13 16:40:13.582976	6768	Tua Tagovailoa	t	\N	Tua	Tagovailoa	Active	\N	0	1	2025-11-13 16:40:13.582976	4241479	https://sleepercdn.com/content/nfl/players/6768.jpg
8154	RB	WAS	t	2025-11-13 16:40:13.969171	8154	Brian Robinson	t	\N	Brian	Robinson	Active	\N	0	3	2025-11-13 16:40:13.969171	4241474	https://sleepercdn.com/content/nfl/players/8154.jpg
7538	QB	MIA	t	2025-11-13 16:40:13.737205	7538	Zach Wilson	t	\N	Zach	Wilson	Active	\N	0	\N	2025-11-13 16:40:13.737205	4361259	https://sleepercdn.com/content/nfl/players/7538.jpg
12502	TE	TEN	t	2025-11-13 16:40:14.620832	12502	Gunnar Helm	t	\N	Gunnar	Helm	Active	\N	0	84	2025-11-13 16:40:14.620832	4686728	https://sleepercdn.com/content/nfl/players/12502.jpg
11261	K	CLE	t	2025-11-13 16:40:14.317055	11261	Andre Szmyt	t	\N	Andre	Szmyt	Active	\N	0	25	2025-11-13 16:40:14.317055	4258620	https://sleepercdn.com/content/nfl/players/11261.jpg
11786	K	JAX	t	2025-11-13 16:40:14.497592	11786	Cam Little	t	\N	Cam	Little	Active	\N	0	39	2025-11-13 16:40:14.497592	4686361	https://sleepercdn.com/content/nfl/players/11786.jpg
11559	QB	ATL	t	2025-11-13 16:40:14.357343	11559	Michael Penix	t	\N	Michael	Penix	Active	\N	0	9	2025-11-13 16:40:14.357343	4360423	https://sleepercdn.com/content/nfl/players/11559.jpg
11631	WR	JAX	t	2025-11-13 16:40:14.452635	11631	Brian Thomas	t	\N	Brian	Thomas	Active	Questionable	0	7	2025-11-13 16:40:14.452635	4432773	https://sleepercdn.com/content/nfl/players/11631.jpg
12521	TE	SEA	t	2025-11-13 16:40:14.662371	12521	Elijah Arroyo	t	\N	Elijah	Arroyo	Active	\N	0	18	2025-11-13 16:40:14.662371	4678006	https://sleepercdn.com/content/nfl/players/12521.jpg
12508	QB	NYG	t	2025-11-13 16:40:14.632453	12508	Jaxson Dart	t	\N	Jaxson	Dart	Inactive	Out	0	6	2025-11-13 16:40:14.632453	4689114	https://sleepercdn.com/content/nfl/players/12508.jpg
12512	RB	CLE	t	2025-11-13 16:40:14.638145	12512	Quinshon Judkins	t	\N	Quinshon	Judkins	Active	\N	0	10	2025-11-13 16:40:14.638145	4685702	https://sleepercdn.com/content/nfl/players/12512.jpg
12526	WR	CAR	t	2025-11-13 16:40:14.679691	12526	Tetairoa McMillan	t	\N	Tetairoa	McMillan	Active	\N	0	4	2025-11-13 16:40:14.679691	4685472	https://sleepercdn.com/content/nfl/players/12526.jpg
12518	TE	IND	t	2025-11-13 16:40:14.656199	12518	Tyler Warren	t	\N	Tyler	Warren	Active	\N	0	84	2025-11-13 16:40:14.656199	4431459	https://sleepercdn.com/content/nfl/players/12518.jpg
11371	TE	MIA	t	2025-11-13 16:40:14.322705	11371	Julian Hill	t	\N	Julian	Hill	Active	Questionable	0	89	2025-11-13 16:40:14.322705	4365395	https://sleepercdn.com/content/nfl/players/11371.jpg
9509	RB	ATL	t	2025-11-13 16:40:14.180439	9509	Bijan Robinson	t	\N	Bijan	Robinson	Active	\N	0	7	2025-11-13 16:40:14.180439	4430807	https://sleepercdn.com/content/nfl/players/9509.jpg
10859	TE	DET	t	2025-11-11 23:14:18.759681	10859	Sam LaPorta	t	\N	Sam	LaPorta	Active	Questionable	0	87	2025-11-13 16:40:14.273674	4430027	https://sleepercdn.com/content/nfl/players/10859.jpg
11058	K	NO	t	2025-11-13 16:40:14.299884	11058	Blake Grupe	t	\N	Blake	Grupe	Active	\N	0	19	2025-11-13 16:40:14.299884	4259619	https://sleepercdn.com/content/nfl/players/11058.jpg
NE	DEF	NE	t	2025-11-13 16:40:14.760866	NE	New England Patriots	t	\N	New England	Patriots	Active	\N	0	\N	2025-11-13 16:40:14.760866	\N	https://sleepercdn.com/images/team_logos/nfl/ne.png
SEA	DEF	SEA	t	2025-11-13 16:40:14.795847	SEA	Seattle Seahawks	t	\N	Seattle	Seahawks	Active	\N	0	\N	2025-11-13 16:40:14.795847	\N	https://sleepercdn.com/images/team_logos/nfl/sea.png
DAL	DEF	DAL	t	2025-11-13 16:40:14.812515	DAL	Dallas Cowboys	t	\N	Dallas	Cowboys	Active	\N	0	\N	2025-11-13 16:40:14.812515	\N	https://sleepercdn.com/images/team_logos/nfl/dal.png
ATL	DEF	ATL	t	2025-11-13 16:40:14.840438	ATL	Atlanta Falcons	t	\N	Atlanta	Falcons	Active	\N	0	\N	2025-11-13 16:40:14.840438	\N	https://sleepercdn.com/images/team_logos/nfl/atl.png
NO	DEF	NO	t	2025-11-13 16:40:14.864612	NO	New Orleans Saints	t	\N	New Orleans	Saints	Active	\N	0	\N	2025-11-13 16:40:14.864612	\N	https://sleepercdn.com/images/team_logos/nfl/no.png
NYG	DEF	NYG	t	2025-11-13 16:40:14.909974	NYG	New York Giants	t	\N	New York	Giants	Active	\N	0	\N	2025-11-13 16:40:14.909974	\N	https://sleepercdn.com/images/team_logos/nfl/nyg.png
CIN	DEF	CIN	t	2025-11-13 16:40:14.92809	CIN	Cincinnati Bengals	t	\N	Cincinnati	Bengals	Active	\N	0	\N	2025-11-13 16:40:14.92809	\N	https://sleepercdn.com/images/team_logos/nfl/cin.png
9226	RB	MIA	t	2025-11-13 16:40:14.108932	9226	De'Von Achane	t	\N	De'Von	Achane	Active	\N	0	28	2025-11-13 16:40:14.108932	4429160	https://sleepercdn.com/content/nfl/players/9226.jpg
11539	K	DET	t	2025-11-11 23:14:18.771582	11539	Jake Bates	t	\N	Jake	Bates	Active	\N	0	39	2025-11-13 16:40:14.34604	4689936	https://sleepercdn.com/content/nfl/players/11539.jpg
12713	K	NE	t	2025-11-13 16:40:14.732114	12713	Andy Borregales	t	\N	Andy	Borregales	Active	\N	0	36	2025-11-13 16:40:14.732114	4569923	https://sleepercdn.com/content/nfl/players/12713.jpg
7588	RB	DAL	t	2025-11-13 16:40:13.782705	7588	Javonte Williams	t	\N	Javonte	Williams	Active	\N	0	33	2025-11-13 16:40:13.782705	4361579	https://sleepercdn.com/content/nfl/players/7588.jpg
12961	K	CAR	t	2025-11-13 16:40:14.743697	12961	Ryan Fitzgerald	t	\N	Ryan	Fitzgerald	Active	\N	0	10	2025-11-13 16:40:14.743697	4568263	https://sleepercdn.com/content/nfl/players/12961.jpg
11571	RB	NYJ	t	2025-11-13 16:40:14.384842	11571	Isaiah Davis	t	\N	Isaiah	Davis	Active	\N	0	32	2025-11-13 16:40:14.384842	4695404	https://sleepercdn.com/content/nfl/players/11571.jpg
11625	WR	NYJ	t	2025-11-13 16:40:14.435823	11625	Adonai Mitchell	t	\N	Adonai	Mitchell	Active	\N	0	15	2025-11-13 16:40:14.435823	4597500	https://sleepercdn.com/content/nfl/players/11625.jpg
12412	RB	NE	t	2025-11-13 16:40:14.539735	12412	Terrell Jennings	t	\N	Terrell	Jennings	Active	Questionable	0	26	2025-11-13 16:40:14.539735	4427600	https://sleepercdn.com/content/nfl/players/12412.jpg
12490	RB	JAX	t	2025-11-13 16:40:14.585343	12490	Bhayshul Tuten	t	\N	Bhayshul	Tuten	Active	\N	0	33	2025-11-13 16:40:14.585343	4882093	https://sleepercdn.com/content/nfl/players/12490.jpg
12499	WR	TEN	t	2025-11-13 16:40:14.614991	12499	Elic Ayomanor	t	\N	Elic	Ayomanor	Active	\N	0	5	2025-11-13 16:40:14.614991	4883647	https://sleepercdn.com/content/nfl/players/12499.jpg
12711	K	BAL	t	2025-11-11 23:14:18.885713	12711	Tyler Loop	t	\N	Tyler	Loop	Active	\N	0	33	2025-11-13 16:40:14.726458	4697745	https://sleepercdn.com/content/nfl/players/12711.jpg
7528	RB	LAC	t	2025-11-11 23:14:18.50808	7528	Najee Harris	t	\N	Najee	Harris	Inactive	IR	0	22	2025-11-11 23:14:18.50808	4241457	https://sleepercdn.com/content/nfl/players/7528.jpg
7564	WR	CIN	t	2025-11-13 16:40:13.758727	7564	Ja'Marr Chase	t	\N	Ja'Marr	Chase	Active	\N	0	1	2025-11-13 16:40:13.758727	4362628	https://sleepercdn.com/content/nfl/players/7564.jpg
7591	QB	NYJ	t	2025-11-13 16:40:13.788047	7591	Justin Fields	t	\N	Justin	Fields	Active	\N	0	7	2025-11-13 16:40:13.788047	4362887	https://sleepercdn.com/content/nfl/players/7591.jpg
7891	TE	DET	t	2025-11-11 23:14:18.562284	7891	Brock Wright	t	\N	Brock	Wright	Active	Questionable	0	89	2025-11-13 16:40:13.834375	4242392	https://sleepercdn.com/content/nfl/players/7891.jpg
8126	WR	NYG	t	2025-11-13 16:40:13.890791	8126	Wan'Dale Robinson	t	\N	Wan'Dale	Robinson	Active	\N	0	17	2025-11-13 16:40:13.890791	4569587	https://sleepercdn.com/content/nfl/players/8126.jpg
8134	WR	BUF	t	2025-11-11 23:14:18.594475	8134	Khalil Shakir	t	\N	Khalil	Shakir	Active	Questionable	0	10	2025-11-13 16:40:13.913443	4373678	https://sleepercdn.com/content/nfl/players/8134.jpg
8155	RB	NYJ	t	2025-11-13 16:40:13.974794	8155	Breece Hall	t	\N	Breece	Hall	Active	\N	0	20	2025-11-13 16:40:13.974794	4427366	https://sleepercdn.com/content/nfl/players/8155.jpg
8227	TE	ATL	t	2025-11-13 16:40:14.039522	8227	Teagan Quitoriano	t	\N	Teagan	Quitoriano	Active	\N	0	85	2025-11-13 16:40:14.039522	4374045	https://sleepercdn.com/content/nfl/players/8227.jpg
10213	WR	LV	t	2025-11-13 16:40:14.222378	10213	Tre Tucker	t	\N	Tre	Tucker	Active	\N	0	1	2025-11-13 16:40:14.222378	4428718	https://sleepercdn.com/content/nfl/players/10213.jpg
4199	RB	MIN	t	2025-11-11 23:14:18.254943	4199	Aaron Jones	t	\N	Aaron	Jones	Active	Questionable	0	33	2025-11-13 16:40:13.245772	3042519	https://sleepercdn.com/content/nfl/players/4199.jpg
2152	QB	TB	t	2025-11-11 23:14:18.175603	2152	Teddy Bridgewater	t	\N	Teddy	Bridgewater	Active	\N	0	10	2025-11-13 16:40:13.060512	16728	https://sleepercdn.com/content/nfl/players/2152.jpg
12487	TE	LAR	t	2025-11-11 23:14:18.85498	12487	Terrance Ferguson	t	\N	Terrance	Ferguson	Active	\N	0	18	2025-11-11 23:14:18.85498	4570037	https://sleepercdn.com/content/nfl/players/12487.jpg
7571	WR	BAL	t	2025-11-11 23:14:18.531226	7571	Rashod Bateman	t	\N	Rashod	Bateman	Active	Questionable	0	7	2025-11-11 23:14:18.531226	4360939	https://sleepercdn.com/content/nfl/players/7571.jpg
MIN	DEF	MIN	t	2025-11-11 23:14:18.972262	MIN	Minnesota Vikings	t	\N	Minnesota	Vikings	Active	\N	0	\N	2025-11-13 16:40:14.947647	\N	https://sleepercdn.com/images/team_logos/nfl/min.png
6826	TE	CHI	t	2025-11-13 16:40:13.643905	6826	Cole Kmet	t	\N	Cole	Kmet	Active	Questionable	0	85	2025-11-13 16:40:13.643905	4258595	https://sleepercdn.com/content/nfl/players/6826.jpg
8122	RB	ARI	t	2025-11-13 16:40:13.879911	8122	Zonovan Knight	t	\N	Zonovan	Knight	Active	Questionable	0	20	2025-11-13 16:40:13.879911	4372035	https://sleepercdn.com/content/nfl/players/8122.jpg
11638	WR	SF	t	2025-11-13 16:40:14.469181	11638	Ricky Pearsall	t	\N	Ricky	Pearsall	Active	Questionable	0	1	2025-11-13 16:40:14.469181	4428209	https://sleepercdn.com/content/nfl/players/11638.jpg
8932	K	GB	t	2025-11-11 23:14:18.685688	8932	Lucas Havrisik	t	\N	Lucas	Havrisik	Active	\N	0	35	2025-11-13 16:40:14.085494	4245661	https://sleepercdn.com/content/nfl/players/8932.jpg
9487	WR	JAX	t	2025-11-13 16:40:14.146588	9487	Parker Washington	t	\N	Parker	Washington	Active	Questionable	0	11	2025-11-13 16:40:14.146588	4432620	https://sleepercdn.com/content/nfl/players/9487.jpg
9508	RB	TEN	t	2025-11-13 16:40:14.174806	9508	Tyjae Spears	t	\N	Tyjae	Spears	Active	\N	0	2	2025-11-13 16:40:14.174806	4428557	https://sleepercdn.com/content/nfl/players/9508.jpg
9757	RB	NO	t	2025-11-13 16:40:14.204354	9757	Kendre Miller	t	\N	Kendre	Miller	Inactive	IR	0	5	2025-11-13 16:40:14.204354	4599739	https://sleepercdn.com/content/nfl/players/9757.jpg
\.


--
-- Data for Name: position_requirements; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.position_requirements (id, "position", required_count, display_name, display_order, is_active, created_at, updated_at) FROM stdin;
2	RB	2	Running Back	2	t	2025-10-26 14:53:00.139197	2025-10-26 14:53:00.139197
4	TE	1	Tight End	4	t	2025-10-26 14:53:00.139197	2025-10-26 14:53:00.139197
6	K	1	Kicker	6	t	2025-10-26 14:53:00.139197	2025-10-26 14:53:00.139197
1	QB	1	Quarterback	1	t	2025-10-26 14:53:00.139197	2025-10-28 04:41:58.977081
3	WR	2	Wide Receiver	3	t	2025-10-26 14:53:00.139197	2025-10-28 05:22:21.234307
21	DEF	1	Defense/ST	6	t	2025-11-02 19:21:54.290086	2025-11-02 19:21:54.290086
5	FLEX	1	Flex (RB/WR/TE)	5	f	2025-10-26 14:53:00.139197	2025-12-02 03:02:26.047548
7	DST	1	Defense/Special Teams	7	f	2025-10-26 14:53:00.139197	2025-12-05 04:02:27.233702
\.


--
-- Data for Name: rules_content; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.rules_content (id, section, content, display_order, created_at, updated_at) FROM stdin;
2	scoring_rules	PPR Scoring applies\n\nPassing: 25 yards per point (6 points at 400 yards bonus), 6 points per TD, -2 per interception\nRushing: 10 yards per point (6 points at 150 yards bonus), 6 points per TD\nReceiving: 1 point per reception, 10 yards per point (6 points at 150 yards bonus), 6 points per TD\nOther: 6 points return TD, 2 points per 2-pt conversion, -2 per fumble lost, 6 points offensive fumble return TD\n\nKickers: Distance-based FG scoring (3-5 points), Missed FG penalties (-3 to -2 points), 1 point per PAT, -1 per missed PAT\n\nDefense/ST: 1 point per sack, 2 per INT/fumble recovery, 6 per TD, 2 per safety, 4 per blocked kick, Points allowed sliding scale (20 to -4 points)	2	2025-10-26 14:53:00.184282	2025-10-26 14:53:00.184282
3	payout	Prize pool based on entry fees. Configurable percentages:\n1st Place: 70%\n2nd Place: 20%\n3rd Place: 10%	3	2025-10-26 14:53:00.184282	2025-10-26 14:53:00.184282
8	overview	Welcome to the Playoff Challenge! Pick your NFL players and compete against friends through the NFL playoffs. Points are awarded based on real player performance.	1	2025-11-02 19:21:54.371225	2025-11-02 19:21:54.371225
10	multipliers	Keep a player for consecutive weeks to earn multipliers: Week 2 = 2x points, Week 3 = 3x points, Week 4 = 4x points. Use this strategy to maximize high-performing players!	3	2025-11-02 19:21:54.371225	2025-11-02 19:21:54.371225
11	deadlines	Lineups must be set before the first game of each playoff round. Once games start, lineups are locked for that week.	4	2025-11-02 19:21:54.371225	2025-11-02 19:21:54.371225
12	payouts	Prize pool is divided among top finishers. Entry fee is $50 per person. See Payouts tab for current prize breakdown.	5	2025-11-02 19:21:54.371225	2025-11-02 19:21:54.371225
13	terms_of_service	TERMS OF SERVICE  Last Updated: December 14, 2025  Please read these Terms of Service carefully before using our mobile gaming application. By downloading, installing, or using the App, you agree to be bound by these Terms. If you do not agree to these Terms, do not use the App.   1. Acceptance of Terms  By accessing or using the App, you acknowledge that you have read, understood, and agree to be bound by these Terms and our Privacy Policy. These Terms constitute a legally binding agreement between you and 67 Enterprises, LLC (the "Company," "we," "us," or "our").   2. Eligibility  You must be at least 18 years old to use the App. We may use commercially reasonable methods to verify your age at account creation or at any time thereafter. We reserve the right to request proof of age and additional verification documentation at our discretion.  By using the App, you represent and warrant that you are at least 18 years old, have the legal capacity to enter into these Terms, and meet all eligibility requirements. Providing false information about your age or identity is prohibited and may result in immediate account termination.   3. Nature of Games – Skill-Based Gaming  The App features skill-based games where outcomes are determined primarily by player skill, strategy, ability, and performance rather than chance. Success in our games requires practice, skill development, strategic decision-making, and learned capabilities.  Our games are games of skill and not games of chance. The outcome of each game is determined by factors including but not limited to:  - Player ability - Strategic choices - Timing - Accuracy - Pattern recognition - Problem-solving skills - Other abilities that can be developed through practice and experience  IMPORTANT NOTICE:  - These games are not gambling and do not constitute illegal gaming activities - Outcomes are based on skill, not random chance - A skilled player will consistently achieve better results than an unskilled   player - Success depends on practice, strategy, and player ability   4. Geographic Restrictions and Availability  The App may not be available in all jurisdictions. We use geolocation technology to determine your location and verify eligibility to use certain features of the App.  We reserve the right to restrict, limit, or deny access to the App or certain features based on geographic location to comply with applicable federal, state, and local laws. You may not use VPNs, proxies, or other methods to circumvent geographic restrictions.  By using the App, you represent and warrant that you are located in a jurisdiction where use of the App is legal and that you will not access the App from any jurisdiction where such access is prohibited.   5. License Grant  Subject to your compliance with these Terms, we grant you a limited, non-exclusive, non-transferable, non-sublicensable, revocable license to download, install, and use the App on a compatible iOS device that you own or control, solely for your personal, non-commercial use.  You may not:  - Copy, modify, or create derivative works of the App - Reverse engineer, decompile, or disassemble the App - Remove, alter, or obscure any proprietary notices - Rent, lease, lend, sell, or redistribute the App - Use the App for any unlawful or unauthorized purpose   6. User Accounts  To access certain features of the App, you may be required to create an account. You agree to:  - Provide accurate, current, and complete information during registration - Maintain and promptly update your account information - Maintain the security of your password and account - Accept all responsibility for activity under your account  You must notify us immediately of any unauthorized use of your account or any other breach of security.   7. In-App Purchases  The App may offer in-app purchases, including virtual currency, items, or premium features. All purchases are final and non-refundable except as required by applicable law or as otherwise stated in our refund policy.  Pricing for virtual items is subject to change without notice. We reserve the right to modify, suspend, or discontinue any virtual items at any time. Virtual items have no monetary value and cannot be exchanged for cash or real-world goods.  All in-app purchases are processed through the Apple App Store and are subject to Apple’s terms and conditions.   8. Anti-Money Laundering and Prohibited Financial Activities  We prohibit the use of the App for money laundering, terrorist financing, fraud, or any other illegal financial activities. We reserve the right to monitor transactions and account activity for suspicious behavior.  You agree that you will not:  - Use the App to launder money or conceal the source of funds - Engage in fraudulent transactions or misrepresent transaction information - Use the App to transfer funds for illegal purposes - Violate any applicable anti-money laundering laws or regulations  We may report suspicious activity to appropriate law enforcement and regulatory authorities. We reserve the right to suspend or terminate accounts and withhold funds if we suspect illegal activity.   9. User Conduct  You agree not to engage in any of the following prohibited activities:  - Cheating, hacking, or using unauthorized third-party software - Harassing, threatening, or abusing other users - Posting offensive, obscene, or inappropriate content - Impersonating another person or entity - Interfering with or disrupting the App or servers - Collecting or harvesting user data without authorization - Violating any applicable laws or regulations  We reserve the right to suspend or terminate your account for any violation of these conduct rules.   10. Intellectual Property  The App and all content, features, and functionality are owned by 67 Enterprises, LLC and are protected by copyright, trademark, and other intellectual property laws. Our trademarks and trade dress may not be used without our prior written permission.  Any feedback, suggestions, or ideas you provide regarding the App may be used by us without any obligation to you.   11. Privacy  Your use of the App is also governed by our Privacy Policy, which describes how we collect, use, and protect your personal information. By using the App, you consent to our collection and use of your information as described in the Privacy Policy.   12. Third-Party Services  The App may contain links to third-party websites or services, including social media platforms, advertising networks, or analytics providers. We are not responsible for the content, privacy policies, or practices of any third-party services.  Your use of third-party services is at your own risk and subject to their respective terms and conditions.   13. Disclaimers  THE APP IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED. WE DISCLAIM ALL WARRANTIES, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.  We do not warrant that the App will be uninterrupted, error-free, or free of viruses or other harmful components. We do not guarantee any specific results from using the App.   14. Limitation of Liability  TO THE MAXIMUM EXTENT PERMITTED BY LAW, THE COMPANY SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS OR REVENUES, WHETHER INCURRED DIRECTLY OR INDIRECTLY, OR ANY LOSS OF DATA, USE, GOODWILL, OR OTHER INTANGIBLE LOSSES.  Our total liability to you for all claims arising from or related to the App shall not exceed the amount you paid us in the twelve months preceding the claim, or one hundred dollars ($100), whichever is greater.   15. Indemnification  You agree to indemnify, defend, and hold harmless 67 Enterprises, LLC and its officers, directors, employees, and agents from any claims, liabilities, damages, losses, costs, or expenses arising from your use of the App, your violation of these Terms, or your violation of any rights of another party.   16. Termination  We may suspend or terminate your access to the App at any time, with or without cause or notice, including for violation of these Terms. Upon termination, your license to use the App will immediately cease.  You may terminate your account at any time by deleting the App from your device and ceasing all use. Sections of these Terms that by their nature should survive termination will survive.   17. Changes to Terms  We reserve the right to modify these Terms at any time. We will notify you of any material changes by posting the updated Terms within the App or by other means. Your continued use of the App after changes become effective constitutes acceptance of the modified Terms.  If you do not agree to the modified Terms, you must stop using the App.   18. Governing Law and Dispute Resolution  These Terms shall be governed by and construed in accordance with the laws of Texas, USA, without regard to its conflict of law provisions.  Any disputes arising from these Terms or your use of the App shall be resolved through binding arbitration in accordance with the rules of the American Arbitration Association, except that either party may seek injunctive relief in court to protect intellectual property rights.  You waive any right to participate in a class action lawsuit or class-wide arbitration.   19. Apple-Specific Terms  For users accessing the App through an iOS device, the following additional terms apply:  - This Agreement is between you and 67 Enterprises, LLC only, not Apple Inc. - Apple has no obligation to provide maintenance or support for the App - In the event of any failure to conform to warranty, you may notify Apple for a   refund, and Apple has no other warranty obligation - Apple is not responsible for addressing any claims relating to the App - Apple is a third-party beneficiary of this Agreement and may enforce these   Terms - You must comply with applicable third-party terms when using the App   20. Miscellaneous  Entire Agreement: These Terms, together with our Privacy Policy, constitute the entire agreement between you and 67 Enterprises, LLC regarding the App.  Severability: If any provision of these Terms is found to be unenforceable, the remaining provisions will remain in full force and effect.  Waiver: No waiver of any term shall be deemed a further or continuing waiver of such term or any other term.  Assignment: You may not assign or transfer these Terms without our prior written consent. We may assign these Terms without restriction.   21. Contact Information  If you have any questions about these Terms, please contact us at:  67 Enterprises, LLC 9036 Westbriar Drive Dallas, Texas, 75228 Email: Sixty7Enterprises@gmail.com Phone: (214) 460-7348   By using the App, you acknowledge that you have read and understood these Terms of Service and agree to be bound by them.	100	2025-12-12 21:55:19	2025-12-17 03:52:49.524136
9	player_selection	Select your lineup for each playoff week based on position requirements. Players can only be used once across all weeks unless you use the multiplier strategy by keeping them in consecutive weeks.	2	2025-11-02 19:21:54.371225	2025-12-02 02:54:09.610777
1	main_rules	Players earn points in the playoffs via the configured scoring system, with a bonus multiplier. The fantasy points accumulated by each player during one weekly scoring period will be multiplied by the number of consecutive weeks in which the player has been in your lineup. A player can earn bonus-point multipliers of 2x, 3x or 4x for a given week based on the number of consecutive weeks that player is on the fantasy team roster.\n\nYou can swap players out each week based on the matchups, but the multipliers reset with every change, so take that into consideration.\n\nPlayers that are started the first week of playoffs with a bye, will not score any points that week, but will have a 2x multiplier the following week.	1	2025-10-26 14:53:00.184282	2025-12-05 04:02:00.863336
\.


--
-- Data for Name: scores; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.scores (id, user_id, player_id, week_number, points, updated_at, base_points, multiplier, final_points, stats_json) FROM stdin;
11afd855-59f5-486a-8e21-7fd4906ab730	8091de58-9e82-49e2-8712-beaa1486d9ff	8138	19	0.00	2026-01-11 04:54:45.82919	0.00	1.0	0.00	{}
e8da396b-d2f4-4bb9-ae6f-e642ecbb669a	8091de58-9e82-49e2-8712-beaa1486d9ff	4866	19	0.00	2026-01-11 04:54:45.907731	0.00	1.0	0.00	{}
f1707571-96a7-4d05-b0ae-1838e2d97f81	8091de58-9e82-49e2-8712-beaa1486d9ff	5022	19	0.00	2026-01-11 04:54:45.956176	0.00	1.0	0.00	{}
2720eae6-71f0-4d57-8caa-ac4907f7c9bb	8091de58-9e82-49e2-8712-beaa1486d9ff	5859	19	0.00	2026-01-11 04:54:46.014478	0.00	1.0	0.00	{}
0393ba6d-268c-48b6-92ed-537b4937f8f0	8091de58-9e82-49e2-8712-beaa1486d9ff	9488	19	0.00	2026-01-11 04:54:46.067577	0.00	1.0	0.00	{}
81c0c581-701b-4413-a7cc-c6305bf9b19f	8091de58-9e82-49e2-8712-beaa1486d9ff	9493	19	34.50	2026-01-11 04:54:46.072772	34.50	1.0	34.50	{"rec": 10, "fg_att": 0, "rec_td": 1, "rec_yd": 111, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 1, "rush_yd": 14, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
1c9a006e-b176-4a1d-8c7f-5394d4e0a846	7bc28e3c-d2a2-4a70-b5a4-6d65eff6e757	8150	19	15.50	2026-01-11 04:54:46.118415	15.50	1.0	15.50	{"rec": 2, "fg_att": 0, "rec_td": 1, "rec_yd": 18, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 0, "rush_yd": 57, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
cac598d4-5598-4dbc-b9db-69bcad2cf734	e89cb6a2-d04a-44a1-878e-3f70304f3383	11563	19	0.00	2026-01-11 04:54:46.226931	0.00	1.0	0.00	{}
e0649c08-f47d-4df2-8392-4e18fa84bfe1	d24ad709-1f34-4a5c-94c0-c3be9b11c243	4034	19	0.00	2026-01-11 04:54:48.577591	0.00	1.0	0.00	{}
2519a6ff-03d4-43d8-bc0e-3f5ccde52053	d24ad709-1f34-4a5c-94c0-c3be9b11c243	12529	19	0.00	2026-01-11 04:54:48.61921	0.00	1.0	0.00	{}
76525956-6f95-4fe0-bc64-d21cdc491a22	d24ad709-1f34-4a5c-94c0-c3be9b11c243	7049	19	0.00	2026-01-11 04:54:48.672153	0.00	1.0	0.00	{}
2f52f345-9c12-4085-98eb-c478016faa8f	78228a8f-0563-44b2-bee2-1db1699c6cd9	8138	19	0.00	2026-01-11 04:54:47.807603	0.00	1.0	0.00	{}
15c7f696-77ad-47cf-a37e-adbdca8335bf	78228a8f-0563-44b2-bee2-1db1699c6cd9	4217	19	0.00	2026-01-11 04:54:47.987024	0.00	1.0	0.00	{}
2990edeb-faf0-49c0-af4f-d115d71471ab	d24ad709-1f34-4a5c-94c0-c3be9b11c243	9487	19	0.00	2026-01-11 04:54:48.155923	0.00	1.0	0.00	{}
c5599bfa-7b4c-4396-89e7-bbdb9528ec5e	8091de58-9e82-49e2-8712-beaa1486d9ff	4984	19	0.00	2026-01-11 04:54:48.294777	0.00	1.0	0.00	{}
0bbc08cc-8490-4afb-8f84-764c315e2676	b1abaca0-b950-4f59-a54b-4d9bf54b9d0f	6804	19	30.02	2026-01-11 04:54:48.372551	30.02	1.0	30.02	{"rec": 0, "fg_att": 0, "rec_td": 0, "rec_yd": 0, "xp_att": 0, "fg_made": 0, "pass_td": 4, "pass_yd": 323, "rec_2pt": 0, "rush_td": 0, "rush_yd": 11, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
0733782b-4e38-480d-82eb-89c4039baf0e	b1abaca0-b950-4f59-a54b-4d9bf54b9d0f	4217	19	0.00	2026-01-11 04:54:48.413401	0.00	1.0	0.00	{}
9840e40c-0202-425a-ad86-a4d61c463975	e5274a58-b24c-45fb-ad7b-711af3d66ea7	4984	19	0.00	2026-01-11 04:54:46.301626	0.00	1.0	0.00	{}
739bf0f9-194c-4d8c-bcc3-9a9baf313575	c05554c7-c311-43c6-a070-40cb889e840a	6904	19	0.00	2026-01-11 04:54:46.488477	0.00	1.0	0.00	{}
b03f8810-a44a-4c03-96fc-b6412e7eaefa	c05554c7-c311-43c6-a070-40cb889e840a	5022	19	0.00	2026-01-11 04:54:46.692566	0.00	1.0	0.00	{}
9c0e8930-13f7-4cb3-95e9-a27feb1d781e	d24ad709-1f34-4a5c-94c0-c3be9b11c243	9488	19	0.00	2026-01-11 04:54:46.821731	0.00	1.0	0.00	{}
3d5ddee2-706a-4cdb-a995-962f9e5ca4fc	3d0e444e-55af-4dd6-bea8-f7959efca74c	4034	19	0.00	2026-01-11 04:54:47.373496	0.00	1.0	0.00	{}
d5325b42-184a-44f9-9f81-6d04bfe57912	3d0e444e-55af-4dd6-bea8-f7959efca74c	5850	19	6.80	2026-01-11 04:54:47.487791	6.80	1.0	6.80	{"rec": 1, "fg_att": 0, "rec_td": 0, "rec_yd": 3, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 0, "rush_yd": 55, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
9c3449cf-66e7-4fd7-8db6-3d541cb700d8	3d0e444e-55af-4dd6-bea8-f7959efca74c	2449	19	0.00	2026-01-11 04:54:47.540493	0.00	1.0	0.00	{}
e6f92971-6244-453e-b58c-2ea219ceebe3	3d0e444e-55af-4dd6-bea8-f7959efca74c	5189	19	0.00	2026-01-11 04:54:47.694243	0.00	1.0	0.00	{"fg_made": 0, "xp_made": 0}
3cb4afd8-a4d7-496f-a1f6-ff33dcc5eba6	b1abaca0-b950-4f59-a54b-4d9bf54b9d0f	12489	19	0.00	2026-01-11 04:54:48.337866	0.00	1.0	0.00	{}
c5a379b2-c320-443a-9038-4196477d678d	b1abaca0-b950-4f59-a54b-4d9bf54b9d0f	4034	19	0.00	2026-01-11 04:54:48.467034	0.00	1.0	0.00	{}
17cfe55e-04d2-4be9-a593-2926a6ef4d2d	c05554c7-c311-43c6-a070-40cb889e840a	5859	19	0.00	2026-01-11 04:54:46.375387	0.00	1.0	0.00	{}
3dd79129-9f8e-4b5c-a66d-a0e4abadefc1	d24ad709-1f34-4a5c-94c0-c3be9b11c243	7523	19	0.00	2026-01-11 04:54:46.878082	0.00	1.0	0.00	{}
1b33fdfe-65bb-4d47-ba8b-341d7157eaad	3d0e444e-55af-4dd6-bea8-f7959efca74c	9488	19	0.00	2026-01-11 04:54:47.59712	0.00	1.0	0.00	{}
42456caa-5c12-4dc3-90ed-f11bb43308e4	78228a8f-0563-44b2-bee2-1db1699c6cd9	5850	19	6.80	2026-01-11 04:54:47.769382	6.80	1.0	6.80	{"rec": 1, "fg_att": 0, "rec_td": 0, "rec_yd": 3, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 0, "rush_yd": 55, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
fd29ede4-25de-4004-9afe-b0e89f60a295	e89cb6a2-d04a-44a1-878e-3f70304f3383	11631	19	0.00	2026-01-11 04:54:47.882912	0.00	1.0	0.00	{}
4a05e287-0b17-4b1c-b290-d4d9843f5632	8091de58-9e82-49e2-8712-beaa1486d9ff	4195	19	0.00	2026-01-11 04:54:48.09694	0.00	1.0	0.00	{"fg_made": 0, "xp_made": 0}
0504a12e-acad-4486-921a-908bab8d5345	78228a8f-0563-44b2-bee2-1db1699c6cd9	9488	19	0.00	2026-01-11 04:54:48.204723	0.00	1.0	0.00	{}
da8fc8d1-b25e-4d00-98b9-0e63d76a6d60	c05554c7-c311-43c6-a070-40cb889e840a	11635	19	0.00	2026-01-11 04:54:46.541407	0.00	1.0	0.00	{}
9cde457f-4e76-4d81-823b-d77cbd6e60d1	d24ad709-1f34-4a5c-94c0-c3be9b11c243	4217	19	0.00	2026-01-11 04:54:46.73387	0.00	1.0	0.00	{}
46f9ec69-005c-4a86-ba8f-751379e31529	78228a8f-0563-44b2-bee2-1db1699c6cd9	17	19	0.00	2026-01-11 04:54:47.48157	0.00	1.0	0.00	{"fg_made": 0, "xp_made": 0}
5ef04252-d743-407f-a446-864089359988	b1abaca0-b950-4f59-a54b-4d9bf54b9d0f	8167	19	12.60	2026-01-11 04:54:48.36111	12.60	1.0	12.60	{"rec": 3, "fg_att": 0, "rec_td": 1, "rec_yd": 36, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 0, "rush_yd": 0, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
21b447cb-855a-48d3-99cc-a0e418347493	e89cb6a2-d04a-44a1-878e-3f70304f3383	7021	19	2.50	2026-01-11 04:54:46.230999	2.50	1.0	2.50	{"rec": 1, "fg_att": 0, "rec_td": 0, "rec_yd": 6, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 0, "rush_yd": 9, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
196d43a8-d5a6-43c8-983b-7d01ac1f8dec	f99caf13-0faa-495d-b6d5-1366104cfb6c	2133	19	12.20	2026-01-11 04:54:46.381287	12.20	1.0	12.20	{"rec": 5, "fg_att": 0, "rec_td": 0, "rec_yd": 72, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 0, "rush_yd": 0, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
e3ba7719-384b-4a78-8357-28b8fe5341af	c05554c7-c311-43c6-a070-40cb889e840a	5045	19	0.00	2026-01-11 04:54:46.626247	0.00	1.0	0.00	{}
956e5eb1-affb-4138-b6e2-ac61f1363f7b	c05554c7-c311-43c6-a070-40cb889e840a	4195	19	0.00	2026-01-11 04:54:46.78432	0.00	1.0	0.00	{"fg_made": 0, "xp_made": 0}
ffcd1f04-c613-419c-8781-b0b85c77673f	3d0e444e-55af-4dd6-bea8-f7959efca74c	8183	19	0.00	2026-01-11 04:54:47.309305	0.00	1.0	0.00	{}
957050b0-f18b-4cfc-b2a9-34aa010dc6f0	3d0e444e-55af-4dd6-bea8-f7959efca74c	4217	19	0.00	2026-01-11 04:54:47.639728	0.00	1.0	0.00	{}
67b7a359-210d-417a-a245-c84d30c7f765	e89cb6a2-d04a-44a1-878e-3f70304f3383	4983	19	17.90	2026-01-11 04:54:47.887729	17.90	1.0	17.90	{"rec": 6, "fg_att": 0, "rec_td": 1, "rec_yd": 64, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 0, "rush_yd": -5, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
59ff526d-85aa-4efa-a98f-e0e16baa4009	78228a8f-0563-44b2-bee2-1db1699c6cd9	7569	19	0.00	2026-01-11 04:54:48.240656	0.00	1.0	0.00	{}
6bbd9a41-c767-4866-8d1e-83085faf8eb4	7bc28e3c-d2a2-4a70-b5a4-6d65eff6e757	11564	19	0.00	2026-01-11 04:54:49.2432	0.00	1.0	0.00	{}
b00e5357-74c1-494f-924e-15a0521f2659	7bc28e3c-d2a2-4a70-b5a4-6d65eff6e757	12015	19	11.00	2026-01-11 04:54:49.299423	11.00	1.0	11.00	{"rec": 0, "fg_att": 2, "rec_td": 0, "rec_yd": 0, "xp_att": 4, "fg_made": 2, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 0, "rush_yd": 0, "xp_made": 4, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 46}
9faed1ef-1e9b-4f9a-97ff-0e2bf73855f9	7bc28e3c-d2a2-4a70-b5a4-6d65eff6e757	LAR	19	6.00	2026-01-11 04:54:49.531555	6.00	1.0	6.00	{"def_td": 0, "def_int": 2, "def_sack": 3, "def_block": 0, "def_ret_td": 0, "def_safety": 0, "def_fum_rec": 0, "def_pts_allowed": 31}
316ac8f8-1aff-4803-b073-7d1589a5b36a	b25714c1-8c53-4a27-9bb2-110b8f68d4c8	LAR	19	6.00	2026-01-11 04:54:49.827615	6.00	1.0	6.00	{"def_td": 0, "def_int": 2, "def_sack": 3, "def_block": 0, "def_ret_td": 0, "def_safety": 0, "def_fum_rec": 0, "def_pts_allowed": 31}
ace55e65-280c-457b-80d5-e5be61cd275c	c05554c7-c311-43c6-a070-40cb889e840a	4866	19	0.00	2026-01-11 04:54:49.874116	0.00	1.0	0.00	{}
5208f3b1-8e38-44ef-9a3a-d832d59eef09	c05554c7-c311-43c6-a070-40cb889e840a	8138	19	0.00	2026-01-11 04:54:49.911977	0.00	1.0	0.00	{}
9fb2c697-d204-4f44-a68d-6973e9cfb13b	c6d87896-425c-4b88-8660-d0f0e532bdae	11786	19	0.00	2026-01-11 04:54:50.014022	0.00	1.0	0.00	{"fg_made": 0, "xp_made": 0}
d2706be8-2c19-4202-afc5-6170c9309b44	c6d87896-425c-4b88-8660-d0f0e532bdae	7543	19	0.00	2026-01-11 04:54:50.106338	0.00	1.0	0.00	{}
a5c170e4-3488-4c05-a552-b7f9221c91ea	c6d87896-425c-4b88-8660-d0f0e532bdae	9487	19	0.00	2026-01-11 04:54:50.228754	0.00	1.0	0.00	{}
07c04bcb-8ae2-40ad-9502-b61c9742f24c	0477bff2-c2e4-45e2-a00b-225df2154d96	8138	19	0.00	2026-01-11 04:54:50.387246	0.00	1.0	0.00	{}
7c5687a6-b8df-423a-a1f2-600abe748223	0477bff2-c2e4-45e2-a00b-225df2154d96	4034	19	0.00	2026-01-11 04:54:50.431287	0.00	1.0	0.00	{}
a2faa21b-c5b0-4714-86f5-9e85b505cd9c	e3692b76-bcc0-429b-ae4c-cc41b4802cd8	12529	19	0.00	2026-01-11 04:54:50.514366	0.00	1.0	0.00	{}
516c0bdc-dac6-45b6-b3dc-ddf4fd3b9473	e3692b76-bcc0-429b-ae4c-cc41b4802cd8	2449	19	0.00	2026-01-11 04:54:50.553211	0.00	1.0	0.00	{}
6c174736-a00c-4d20-b8f0-3c6656ce3d71	e3692b76-bcc0-429b-ae4c-cc41b4802cd8	4217	19	0.00	2026-01-11 04:54:50.598165	0.00	1.0	0.00	{}
df31c509-0eb5-4a01-91d0-c20cf3c8b53a	e3692b76-bcc0-429b-ae4c-cc41b4802cd8	4034	19	0.00	2026-01-11 04:54:50.740706	0.00	1.0	0.00	{}
77310127-898a-48dc-8adc-7e1b1ce08430	e3692b76-bcc0-429b-ae4c-cc41b4802cd8	7049	19	0.00	2026-01-11 04:54:50.793235	0.00	1.0	0.00	{}
56e8c791-0fde-460d-8402-d341c8110699	be53f692-990b-4ae6-b061-65753d22fb31	2133	19	12.20	2026-01-11 04:54:48.726995	12.20	1.0	12.20	{"rec": 5, "fg_att": 0, "rec_td": 0, "rec_yd": 72, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 0, "rush_yd": 0, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
8a454a54-9f68-412f-899e-b47c8d1ef9ec	be53f692-990b-4ae6-b061-65753d22fb31	12713	19	0.00	2026-01-11 04:54:48.79052	0.00	1.0	0.00	{"fg_made": 0, "xp_made": 0}
366d27a6-ead7-4e30-be47-8c400903c4b3	be53f692-990b-4ae6-b061-65753d22fb31	12529	19	0.00	2026-01-11 04:54:48.889805	0.00	1.0	0.00	{}
77a1885c-897e-4949-9245-fc72a13fcf71	be53f692-990b-4ae6-b061-65753d22fb31	2449	19	0.00	2026-01-11 04:54:48.930633	0.00	1.0	0.00	{}
7c68c8f7-22a9-4a48-b587-5730c069f0ed	96894153-2d54-4b2e-9553-b9e866fd9db3	7042	19	0.00	2026-01-11 04:54:49.100907	0.00	1.0	0.00	{"fg_made": 0, "xp_made": 0}
6009ac86-9732-4051-966a-264066ad915e	7bc28e3c-d2a2-4a70-b5a4-6d65eff6e757	9493	19	34.50	2026-01-11 04:54:49.106038	34.50	1.0	34.50	{"rec": 10, "fg_att": 0, "rec_td": 1, "rec_yd": 111, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 1, "rush_yd": 14, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
9ac48a7b-4494-43c1-b135-594fa6dd99f5	7bc28e3c-d2a2-4a70-b5a4-6d65eff6e757	2133	19	12.20	2026-01-11 04:54:49.114804	12.20	1.0	12.20	{"rec": 5, "fg_att": 0, "rec_td": 0, "rec_yd": 72, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 0, "rush_yd": 0, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
b322dc86-bdee-4dd0-aa20-962d62e19985	7bc28e3c-d2a2-4a70-b5a4-6d65eff6e757	2449	19	0.00	2026-01-11 04:54:49.168566	0.00	1.0	0.00	{}
9972e494-aa11-40ee-a5cc-a238db5cc81f	78228a8f-0563-44b2-bee2-1db1699c6cd9	4984	19	0.00	2026-01-11 04:54:49.199678	0.00	1.0	0.00	{}
f005f9f1-d64d-4b3e-a7fc-6e30d0470bac	7bc28e3c-d2a2-4a70-b5a4-6d65eff6e757	12529	19	0.00	2026-01-11 04:54:49.29409	0.00	1.0	0.00	{}
236ced7f-47ed-47af-bcfc-1604ac206d08	e5274a58-b24c-45fb-ad7b-711af3d66ea7	9493	19	34.50	2026-01-11 04:54:49.537879	34.50	1.0	34.50	{"rec": 10, "fg_att": 0, "rec_td": 1, "rec_yd": 111, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 1, "rush_yd": 14, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
d4dc7e7e-b847-4683-909d-d35d84089323	b25714c1-8c53-4a27-9bb2-110b8f68d4c8	10236	19	0.00	2026-01-11 04:54:49.594961	0.00	1.0	0.00	{}
a1e916f3-b93d-4db4-a91d-b8dff8b0afa2	c6d87896-425c-4b88-8660-d0f0e532bdae	7523	19	0.00	2026-01-11 04:54:50.057852	0.00	1.0	0.00	{}
68dd2fd4-f3a8-4578-a70d-7babe907af77	c6d87896-425c-4b88-8660-d0f0e532bdae	9480	19	0.00	2026-01-11 04:54:50.153584	0.00	1.0	0.00	{}
a83a2e02-43fb-4f0e-91af-8848edaea909	c6d87896-425c-4b88-8660-d0f0e532bdae	9488	19	0.00	2026-01-11 04:54:50.190771	0.00	1.0	0.00	{}
0ecf3be4-e186-434a-8d97-33cd6b2ebafd	0477bff2-c2e4-45e2-a00b-225df2154d96	2747	19	0.00	2026-01-11 04:54:50.329265	0.00	1.0	0.00	{"fg_made": 0, "xp_made": 0}
ec9c245f-542a-4cd9-b98d-51e72384123e	0477bff2-c2e4-45e2-a00b-225df2154d96	421	19	22.16	2026-01-11 04:54:50.334006	22.16	1.0	22.16	{"rec": 0, "fg_att": 0, "rec_td": 0, "rec_yd": 0, "xp_att": 0, "fg_made": 0, "pass_td": 3, "pass_yd": 304, "rec_2pt": 0, "rush_td": 0, "rush_yd": 0, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 1, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
ab41eba3-68fb-4e82-a8db-09cc6a997799	e3692b76-bcc0-429b-ae4c-cc41b4802cd8	11564	19	0.00	2026-01-11 04:54:50.480021	0.00	1.0	0.00	{}
1b176e4f-abd6-405e-b3f4-ae911cd36ad2	e3692b76-bcc0-429b-ae4c-cc41b4802cd8	12713	19	0.00	2026-01-11 04:54:50.637974	0.00	1.0	0.00	{"fg_made": 0, "xp_made": 0}
2c1ecf2a-0acd-41ab-b1af-69d29bc3f662	be53f692-990b-4ae6-b061-65753d22fb31	11564	19	0.00	2026-01-11 04:54:48.827334	0.00	1.0	0.00	{}
37caf31b-84c1-4050-be9f-3393f50d3fb3	be53f692-990b-4ae6-b061-65753d22fb31	3214	19	0.00	2026-01-11 04:54:49.032747	0.00	1.0	0.00	{}
340f8a98-34d9-47e0-b708-893745fb97e1	b25714c1-8c53-4a27-9bb2-110b8f68d4c8	2133	19	12.20	2026-01-11 04:54:51.453283	12.20	1.0	12.20	{"rec": 5, "fg_att": 0, "rec_td": 0, "rec_yd": 72, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 0, "rush_yd": 0, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
db89e3df-b2d0-46c9-980f-6e01bd920abc	b25714c1-8c53-4a27-9bb2-110b8f68d4c8	5859	19	0.00	2026-01-11 04:54:51.52801	0.00	1.0	0.00	{}
84b69fa1-f1a9-44ce-b375-d0722e5ed543	c5abc1fc-2f96-40f7-82e6-9811a63ed7b5	9493	19	34.50	2026-01-11 04:54:51.67866	34.50	1.0	34.50	{"rec": 10, "fg_att": 0, "rec_td": 1, "rec_yd": 111, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 1, "rush_yd": 14, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
25d2072e-8fda-4854-aa61-8082b9eb5ff3	c5abc1fc-2f96-40f7-82e6-9811a63ed7b5	9488	19	0.00	2026-01-11 04:54:51.726521	0.00	1.0	0.00	{}
5114f445-2403-4d57-a497-aa445589ca47	4477133e-bd55-4596-99da-8e1d6599e923	7569	19	0.00	2026-01-11 04:54:51.978421	0.00	1.0	0.00	{}
7c38b81b-2247-4cd9-8044-0212ff87472e	4477133e-bd55-4596-99da-8e1d6599e923	4866	19	0.00	2026-01-11 04:54:52.088261	0.00	1.0	0.00	{}
8bdc9eef-d2d3-468a-9c52-f416dba17f38	cf84e9bf-0c2c-4237-9768-9828ea922861	11564	19	0.00	2026-01-11 04:54:52.31235	0.00	1.0	0.00	{}
b60c93c3-2452-49d1-b4ea-c9092d6aee56	0477bff2-c2e4-45e2-a00b-225df2154d96	9480	19	0.00	2026-01-11 04:54:50.886163	0.00	1.0	0.00	{}
386ea2dd-364e-4e70-a76a-a506dd833dd4	b9318729-2286-465c-b0ae-f2a150d71ad2	9493	19	34.50	2026-01-11 04:54:51.012808	34.50	1.0	34.50	{"rec": 10, "fg_att": 0, "rec_td": 1, "rec_yd": 111, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 1, "rush_yd": 14, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
42ce16e9-37d6-46cc-9ba6-9ae6fd350d4b	b9318729-2286-465c-b0ae-f2a150d71ad2	4195	19	0.00	2026-01-11 04:54:51.111283	0.00	1.0	0.00	{"fg_made": 0, "xp_made": 0}
1295741e-f550-4791-ac1d-32778087eb9d	b9318729-2286-465c-b0ae-f2a150d71ad2	5859	19	0.00	2026-01-11 04:54:51.270178	0.00	1.0	0.00	{}
561cf9f6-e821-4632-880b-44738ca53ebd	b25714c1-8c53-4a27-9bb2-110b8f68d4c8	4984	19	0.00	2026-01-11 04:54:51.383942	0.00	1.0	0.00	{}
62bb6ab7-dd78-41ff-aa97-76e8da3c1467	c5abc1fc-2f96-40f7-82e6-9811a63ed7b5	11564	19	0.00	2026-01-11 04:54:51.602912	0.00	1.0	0.00	{}
1ed3d2e1-f116-46ce-bcb8-2d9ac560a4d3	0477bff2-c2e4-45e2-a00b-225df2154d96	9488	19	0.00	2026-01-11 04:54:50.924629	0.00	1.0	0.00	{}
0902fb93-b4d8-48f8-a98e-50a5f24e502e	b9318729-2286-465c-b0ae-f2a150d71ad2	4984	19	0.00	2026-01-11 04:54:51.162312	0.00	1.0	0.00	{}
05131c56-15f2-4898-9b28-d4c7462392af	b9318729-2286-465c-b0ae-f2a150d71ad2	4866	19	0.00	2026-01-11 04:54:51.213552	0.00	1.0	0.00	{}
6eec37b8-a9fe-43b0-bf6d-9a529706fcdf	b9318729-2286-465c-b0ae-f2a150d71ad2	3214	19	0.00	2026-01-11 04:54:51.314441	0.00	1.0	0.00	{}
a2b58886-09c8-4ff9-a1af-63d9b422d42a	b25714c1-8c53-4a27-9bb2-110b8f68d4c8	12015	19	11.00	2026-01-11 04:54:51.320009	11.00	1.0	11.00	{"rec": 0, "fg_att": 2, "rec_td": 0, "rec_yd": 0, "xp_att": 4, "fg_made": 2, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 0, "rush_yd": 0, "xp_made": 4, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 46}
9bb573ed-104c-4160-b853-cd6ecc888702	b25714c1-8c53-4a27-9bb2-110b8f68d4c8	8138	19	0.00	2026-01-11 04:54:51.433888	0.00	1.0	0.00	{}
7c6b959d-baff-48ae-8460-62c767b7f609	c5abc1fc-2f96-40f7-82e6-9811a63ed7b5	4866	19	0.00	2026-01-11 04:54:51.664077	0.00	1.0	0.00	{}
409eaf75-f9f0-44e3-b5d2-2997324cd6ee	c5abc1fc-2f96-40f7-82e6-9811a63ed7b5	2449	19	0.00	2026-01-11 04:54:51.801498	0.00	1.0	0.00	{}
2970188c-478d-4b76-98cb-861208a86810	4477133e-bd55-4596-99da-8e1d6599e923	7523	19	0.00	2026-01-11 04:54:51.852156	0.00	1.0	0.00	{}
f36844f6-b090-47fc-8e46-153fb93785e1	4477133e-bd55-4596-99da-8e1d6599e923	3451	19	0.00	2026-01-11 04:54:52.02441	0.00	1.0	0.00	{"fg_made": 0, "xp_made": 0}
db6f2b71-35ad-4ad4-b87b-93136b070ea3	4477133e-bd55-4596-99da-8e1d6599e923	8150	19	15.50	2026-01-11 04:54:52.028727	15.50	1.0	15.50	{"rec": 2, "fg_att": 0, "rec_td": 1, "rec_yd": 18, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 0, "rush_yd": 57, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
4a737528-863d-4c01-b65d-568dcc4689ce	4477133e-bd55-4596-99da-8e1d6599e923	9487	19	0.00	2026-01-11 04:54:52.122344	0.00	1.0	0.00	{}
7256146e-ffaf-4664-ac29-e89daf7dcbf4	c5abc1fc-2f96-40f7-82e6-9811a63ed7b5	9480	19	0.00	2026-01-11 04:54:52.175162	0.00	1.0	0.00	{}
868b92c5-250c-4e92-812c-b7cdeff21633	cf84e9bf-0c2c-4237-9768-9828ea922861	4034	19	0.00	2026-01-11 04:54:52.373512	0.00	1.0	0.00	{}
776db012-1839-439e-b0e5-e4e360d2c0ca	cf84e9bf-0c2c-4237-9768-9828ea922861	4866	19	0.00	2026-01-11 04:54:52.427155	0.00	1.0	0.00	{}
895b773e-0cdb-4722-9c24-53b012134f30	b9318729-2286-465c-b0ae-f2a150d71ad2	8138	19	0.00	2026-01-11 04:54:50.970377	0.00	1.0	0.00	{}
71be51c5-b472-4050-b86d-8159a109e494	b25714c1-8c53-4a27-9bb2-110b8f68d4c8	8150	19	15.50	2026-01-11 04:54:51.43988	15.50	1.0	15.50	{"rec": 2, "fg_att": 0, "rec_td": 1, "rec_yd": 18, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 0, "rush_yd": 57, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
bac7e736-086a-444b-83e6-1a58b3bd5515	b9318729-2286-465c-b0ae-f2a150d71ad2	2449	19	0.00	2026-01-11 04:54:51.007909	0.00	1.0	0.00	{}
0038d975-a726-4b19-bd16-4ea2805e9ad3	cf84e9bf-0c2c-4237-9768-9828ea922861	7569	19	0.00	2026-01-11 04:54:52.497405	0.00	1.0	0.00	{}
4c54030f-a0db-4aac-b81e-16c90ab676b9	c5abc1fc-2f96-40f7-82e6-9811a63ed7b5	8150	19	15.50	2026-01-11 04:54:51.672454	15.50	1.0	15.50	{"rec": 2, "fg_att": 0, "rec_td": 1, "rec_yd": 18, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 0, "rush_yd": 57, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
871cd122-170b-4008-a34b-9d8130910084	4477133e-bd55-4596-99da-8e1d6599e923	4217	19	0.00	2026-01-11 04:54:51.919872	0.00	1.0	0.00	{}
76b7f027-9017-48da-8e4c-72ae29178cba	c5abc1fc-2f96-40f7-82e6-9811a63ed7b5	2747	19	0.00	2026-01-11 04:54:52.219571	0.00	1.0	0.00	{"fg_made": 0, "xp_made": 0}
8a4c7f0f-bf46-44d0-ad75-299c62092d98	f1f4ea45-5e97-4f49-8e3a-69f307c30f16	4984	19	0.00	2026-01-11 04:54:54.383688	0.00	1.0	0.00	{}
335c2ecd-4b8f-42d9-882c-3554fcac37ee	f1f4ea45-5e97-4f49-8e3a-69f307c30f16	7543	19	0.00	2026-01-11 04:54:54.612799	0.00	1.0	0.00	{}
55c98e02-ad94-40fa-a1c9-5f0b40669c71	4477133e-bd55-4596-99da-8e1d6599e923	LAR	19	6.00	2026-01-11 04:54:54.868592	6.00	1.0	6.00	{"def_td": 0, "def_int": 2, "def_sack": 3, "def_block": 0, "def_ret_td": 0, "def_safety": 0, "def_fum_rec": 0, "def_pts_allowed": 31}
584344cf-3fa6-4a8d-a58f-a4744a758c3f	e5274a58-b24c-45fb-ad7b-711af3d66ea7	8138	19	0.00	2026-01-11 04:54:54.92915	0.00	1.0	0.00	{}
09643f5f-acfa-4c9e-9057-c2d371b9066e	e5274a58-b24c-45fb-ad7b-711af3d66ea7	3202	19	0.00	2026-01-11 04:54:55.116124	0.00	1.0	0.00	{}
4473ffee-0b35-4b46-87d8-e1b2c40e2a48	5f31df4f-f1be-4f82-a75e-006323f102d3	4984	19	0.00	2026-01-11 04:54:55.211741	0.00	1.0	0.00	{}
ac6f8a1c-8b25-4d81-a12a-2faf5917d3ef	96894153-2d54-4b2e-9553-b9e866fd9db3	8134	19	0.00	2026-01-11 04:54:52.571472	0.00	1.0	0.00	{}
623a4c6a-9c9a-4d96-9394-d6a3e4693558	f6cb1bd2-d8db-4b9c-92e5-5dcfbb70bced	4984	19	0.00	2026-01-11 04:54:53.241712	0.00	1.0	0.00	{}
ec9f9df9-1871-41ad-a9a5-e8b2e0a9d871	f6cb1bd2-d8db-4b9c-92e5-5dcfbb70bced	9488	19	0.00	2026-01-11 04:54:53.424362	0.00	1.0	0.00	{}
e25c8e5f-9c93-4773-a7a3-a24c8e48cf67	f6cb1bd2-d8db-4b9c-92e5-5dcfbb70bced	4217	19	0.00	2026-01-11 04:54:53.543317	0.00	1.0	0.00	{}
24df938a-35f6-464d-8556-0dee3fc2d78e	a08d1c9e-6070-4f64-a674-0a56a35ec792	9493	19	34.50	2026-01-11 04:54:53.699284	34.50	1.0	34.50	{"rec": 10, "fg_att": 0, "rec_td": 1, "rec_yd": 111, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 1, "rush_yd": 14, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
512e12f2-dcdd-43ce-8b21-bd8ea09b065e	a08d1c9e-6070-4f64-a674-0a56a35ec792	12713	19	0.00	2026-01-11 04:54:53.760282	0.00	1.0	0.00	{"fg_made": 0, "xp_made": 0}
518ed3fb-f292-429c-8d63-a451ddc41cb0	a08d1c9e-6070-4f64-a674-0a56a35ec792	8150	19	15.50	2026-01-11 04:54:53.812537	15.50	1.0	15.50	{"rec": 2, "fg_att": 0, "rec_td": 1, "rec_yd": 18, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 0, "rush_yd": 57, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
2a1a2774-8419-4bb7-bd45-0efe3420304a	a08d1c9e-6070-4f64-a674-0a56a35ec792	12529	19	0.00	2026-01-11 04:54:53.880716	0.00	1.0	0.00	{}
51bf790c-ddee-4791-99c1-29fb6410892b	a08d1c9e-6070-4f64-a674-0a56a35ec792	9488	19	0.00	2026-01-11 04:54:53.922831	0.00	1.0	0.00	{}
871736cf-1661-41f9-a784-52326c2d37c1	9fb7076d-153c-4a44-806e-2b4aef1f57f9	8151	19	0.00	2026-01-11 04:54:54.071647	0.00	1.0	0.00	{}
4bf127b8-8b0d-4eaf-87e7-ed8cdc646300	9fb7076d-153c-4a44-806e-2b4aef1f57f9	9488	19	0.00	2026-01-11 04:54:54.209993	0.00	1.0	0.00	{}
0b2735d0-007e-42f9-88cb-e2a418603574	e5274a58-b24c-45fb-ad7b-711af3d66ea7	7042	19	0.00	2026-01-11 04:54:55.175379	0.00	1.0	0.00	{"fg_made": 0, "xp_made": 0}
dd10323f-a4cc-456d-9479-013401b3aa51	f6cb1bd2-d8db-4b9c-92e5-5dcfbb70bced	9487	19	0.00	2026-01-11 04:54:53.499033	0.00	1.0	0.00	{}
48f8a0f8-8830-4c5a-98cd-1e7df0d5a13e	f6cb1bd2-d8db-4b9c-92e5-5dcfbb70bced	8259	19	0.00	2026-01-11 04:54:53.607526	0.00	1.0	0.00	{"fg_made": 0, "xp_made": 0}
7e109764-1fa0-4fab-80b2-240580fbf8d5	a08d1c9e-6070-4f64-a674-0a56a35ec792	2449	19	0.00	2026-01-11 04:54:53.808348	0.00	1.0	0.00	{}
dba36d08-53f8-43ef-a4b6-ca13c31c7801	a08d1c9e-6070-4f64-a674-0a56a35ec792	3271	19	6.50	2026-01-11 04:54:53.885364	6.50	1.0	6.50	{"rec": 2, "fg_att": 0, "rec_td": 0, "rec_yd": 45, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 0, "rush_yd": 0, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
2c1a1859-2324-4664-a821-8253efff21bd	9fb7076d-153c-4a44-806e-2b4aef1f57f9	11563	19	0.00	2026-01-11 04:54:53.974049	0.00	1.0	0.00	{}
54b9448a-ebd4-475f-91a5-923c635c3acf	9fb7076d-153c-4a44-806e-2b4aef1f57f9	5045	19	0.00	2026-01-11 04:54:54.112678	0.00	1.0	0.00	{}
13544589-b1e3-4a34-82d1-fb759a85bfbb	9fb7076d-153c-4a44-806e-2b4aef1f57f9	6869	19	0.00	2026-01-11 04:54:54.248218	0.00	1.0	0.00	{}
0175b96d-4689-4669-871e-7c92309e580f	f1f4ea45-5e97-4f49-8e3a-69f307c30f16	4034	19	0.00	2026-01-11 04:54:54.432139	0.00	1.0	0.00	{}
5ef53679-5956-469a-b9b2-cf2d15172e57	4477133e-bd55-4596-99da-8e1d6599e923	9493	19	34.50	2026-01-11 04:54:54.618525	34.50	1.0	34.50	{"rec": 10, "fg_att": 0, "rec_td": 1, "rec_yd": 111, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 1, "rush_yd": 14, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
f36450ea-1cb5-44fc-929b-7efbfee42c0e	96894153-2d54-4b2e-9553-b9e866fd9db3	4984	19	0.00	2026-01-11 04:54:54.995065	0.00	1.0	0.00	{}
79352456-aa15-4250-8778-2f152d306214	5f31df4f-f1be-4f82-a75e-006323f102d3	8138	19	0.00	2026-01-11 04:54:55.244619	0.00	1.0	0.00	{}
576e42d8-8f44-4efb-8879-58a996752362	cf84e9bf-0c2c-4237-9768-9828ea922861	9480	19	0.00	2026-01-11 04:54:52.911274	0.00	1.0	0.00	{}
a906366e-c02d-43db-873c-656df640b185	f6cb1bd2-d8db-4b9c-92e5-5dcfbb70bced	12529	19	0.00	2026-01-11 04:54:53.313497	0.00	1.0	0.00	{}
df7cd324-efde-4ab9-8182-3449355bcc8d	f1f4ea45-5e97-4f49-8e3a-69f307c30f16	5859	19	0.00	2026-01-11 04:54:54.502226	0.00	1.0	0.00	{}
97290491-5579-4978-bc52-2fb29c12c2e7	96894153-2d54-4b2e-9553-b9e866fd9db3	8138	19	0.00	2026-01-11 04:54:55.073889	0.00	1.0	0.00	{}
722b969b-4ec2-468c-a564-72d80a9efce8	e5274a58-b24c-45fb-ad7b-711af3d66ea7	2449	19	0.00	2026-01-11 04:54:57.475417	0.00	1.0	0.00	{}
edb3cb0e-ddf9-44e6-a651-c7c0a87a8c7a	96894153-2d54-4b2e-9553-b9e866fd9db3	LAR	19	6.00	2026-01-11 04:54:53.175254	6.00	1.0	6.00	{"def_td": 0, "def_int": 2, "def_sack": 3, "def_block": 0, "def_ret_td": 0, "def_safety": 0, "def_fum_rec": 0, "def_pts_allowed": 31}
7014eef4-2e01-4ed6-9f7a-5bfb30643c0f	f6cb1bd2-d8db-4b9c-92e5-5dcfbb70bced	4034	19	0.00	2026-01-11 04:54:53.374431	0.00	1.0	0.00	{}
3c7fcb4c-a3b4-4a11-a2e6-4212ab71d300	f6cb1bd2-d8db-4b9c-92e5-5dcfbb70bced	9493	19	34.50	2026-01-11 04:54:53.503441	34.50	1.0	34.50	{"rec": 10, "fg_att": 0, "rec_td": 1, "rec_yd": 111, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 1, "rush_yd": 14, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
c5cd3cbf-94d2-4de4-9d4c-a763a79665e9	9fb7076d-153c-4a44-806e-2b4aef1f57f9	12489	19	0.00	2026-01-11 04:54:54.020124	0.00	1.0	0.00	{}
df8d8f51-ddca-4789-a433-4e217b18ddf1	9fb7076d-153c-4a44-806e-2b4aef1f57f9	8676	19	0.00	2026-01-11 04:54:54.155469	0.00	1.0	0.00	{}
45c56a92-3a31-42e5-adaa-c4de726c4ce9	9fb7076d-153c-4a44-806e-2b4aef1f57f9	3678	19	0.00	2026-01-11 04:54:54.292519	0.00	1.0	0.00	{"fg_made": 0, "xp_made": 0}
f6ceac9d-fa08-4c15-91b5-758b8824dbc2	5f31df4f-f1be-4f82-a75e-006323f102d3	5045	19	0.00	2026-01-11 04:54:55.317388	0.00	1.0	0.00	{}
511cea9d-026a-4d1b-8255-42d48a61ae9d	5f31df4f-f1be-4f82-a75e-006323f102d3	17	19	0.00	2026-01-11 04:54:55.477585	0.00	1.0	0.00	{"fg_made": 0, "xp_made": 0}
e719c2de-9483-4869-a122-c44f2811c8a9	f99caf13-0faa-495d-b6d5-1366104cfb6c	7523	19	0.00	2026-01-11 04:54:55.776065	0.00	1.0	0.00	{}
76d5d323-554f-4764-957f-1235ea0945f2	f99caf13-0faa-495d-b6d5-1366104cfb6c	9493	19	34.50	2026-01-11 04:54:55.88227	34.50	1.0	34.50	{"rec": 10, "fg_att": 0, "rec_td": 1, "rec_yd": 111, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 1, "rush_yd": 14, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
c809b0fd-8d1f-4628-8813-a078205cedcd	f99caf13-0faa-495d-b6d5-1366104cfb6c	10214	19	0.00	2026-01-11 04:54:55.921012	0.00	1.0	0.00	{}
eb408478-4e50-48e8-b75a-40c958c4af79	d24ad709-1f34-4a5c-94c0-c3be9b11c243	5189	19	0.00	2026-01-11 04:54:56.017898	0.00	1.0	0.00	{"fg_made": 0, "xp_made": 0}
ab388914-6750-48b4-a682-b87416c108ba	672ac17e-17d2-4773-a623-07026cd98aca	8138	19	0.00	2026-01-11 04:54:56.215022	0.00	1.0	0.00	{}
adfb1f31-2915-438a-9c6a-2e8f6a46d470	672ac17e-17d2-4773-a623-07026cd98aca	5859	19	0.00	2026-01-11 04:54:56.32471	0.00	1.0	0.00	{}
61eb5eff-662c-4345-9a9e-8cba52dde62f	672ac17e-17d2-4773-a623-07026cd98aca	11789	19	0.00	2026-01-11 04:54:56.473439	0.00	1.0	0.00	{"fg_made": 0, "xp_made": 0}
8a616aaa-ecb8-4a3a-83a2-69b6dee0a5ac	c6d87896-425c-4b88-8660-d0f0e532bdae	4034	19	0.00	2026-01-11 04:54:56.584542	0.00	1.0	0.00	{}
0ab3cc5b-23a3-4183-82b7-90a95168ae60	c8c1784c-60e4-4b3d-8efa-7c9fe81aa066	11564	19	0.00	2026-01-11 04:54:56.910393	0.00	1.0	0.00	{}
c53af5fc-d7c3-436b-bde4-2cca71ea7142	336f1ecd-1b0f-42bf-af7f-3eb066b2ea35	8151	19	0.00	2026-01-11 04:54:57.042431	0.00	1.0	0.00	{}
b5f32d36-a22f-47e8-951f-cc40c5be471a	336f1ecd-1b0f-42bf-af7f-3eb066b2ea35	11627	19	0.00	2026-01-11 04:54:57.187475	0.00	1.0	0.00	{}
d3e3abd1-7c04-4bf4-912e-9ec321550f08	336f1ecd-1b0f-42bf-af7f-3eb066b2ea35	12489	19	0.00	2026-01-11 04:54:57.375134	0.00	1.0	0.00	{}
7666fc03-5d65-4b83-bf26-7e22fb2039c6	5f31df4f-f1be-4f82-a75e-006323f102d3	9493	19	34.50	2026-01-11 04:54:55.25616	34.50	1.0	34.50	{"rec": 10, "fg_att": 0, "rec_td": 1, "rec_yd": 111, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 1, "rush_yd": 14, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
c39e618e-51fe-4698-8075-f519c1d8add2	5f31df4f-f1be-4f82-a75e-006323f102d3	2449	19	0.00	2026-01-11 04:54:55.367057	0.00	1.0	0.00	{}
831b5cd4-42e2-44c2-9e34-d3b2eb25d07d	f99caf13-0faa-495d-b6d5-1366104cfb6c	7543	19	0.00	2026-01-11 04:54:55.814662	0.00	1.0	0.00	{}
9de906f1-aa14-46b0-a4e1-3b0f78e1d27b	672ac17e-17d2-4773-a623-07026cd98aca	9493	19	34.50	2026-01-11 04:54:56.219423	34.50	1.0	34.50	{"rec": 10, "fg_att": 0, "rec_td": 1, "rec_yd": 111, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 1, "rush_yd": 14, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
e930cc94-01da-4800-8c95-29b98dd4a992	672ac17e-17d2-4773-a623-07026cd98aca	9488	19	0.00	2026-01-11 04:54:56.37512	0.00	1.0	0.00	{}
b72c32ab-9ef0-4089-a637-d5f339506d2b	0477bff2-c2e4-45e2-a00b-225df2154d96	2133	19	12.20	2026-01-11 04:54:56.523989	12.20	1.0	12.20	{"rec": 5, "fg_att": 0, "rec_td": 0, "rec_yd": 72, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 0, "rush_yd": 0, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
eb1324a2-1dad-4868-acbe-c103420ce96e	c8c1784c-60e4-4b3d-8efa-7c9fe81aa066	12529	19	0.00	2026-01-11 04:54:56.949653	0.00	1.0	0.00	{}
52a01377-59cb-457b-a81b-35ebea0cb48f	336f1ecd-1b0f-42bf-af7f-3eb066b2ea35	5045	19	0.00	2026-01-11 04:54:57.102311	0.00	1.0	0.00	{}
e4eaf36f-990c-4930-85ef-5ea026898174	336f1ecd-1b0f-42bf-af7f-3eb066b2ea35	11603	19	0.00	2026-01-11 04:54:57.235931	0.00	1.0	0.00	{}
2370d909-c6bb-4bb4-ad91-0ddefdff9ee0	3949b108-442c-4bac-b5c9-3dada8fc19b4	9488	19	0.00	2026-01-11 04:54:57.42461	0.00	1.0	0.00	{}
93bf4328-a482-40b5-be4c-5d3cca7097e6	5f31df4f-f1be-4f82-a75e-006323f102d3	LAR	19	6.00	2026-01-11 04:54:55.712522	6.00	1.0	6.00	{"def_td": 0, "def_int": 2, "def_sack": 3, "def_block": 0, "def_ret_td": 0, "def_safety": 0, "def_fum_rec": 0, "def_pts_allowed": 31}
433d8e1f-d78a-40ce-9bfe-1f8f64762750	f99caf13-0faa-495d-b6d5-1366104cfb6c	11786	19	0.00	2026-01-11 04:54:55.968109	0.00	1.0	0.00	{"fg_made": 0, "xp_made": 0}
a681baf1-9593-4a82-878f-885420dc1726	672ac17e-17d2-4773-a623-07026cd98aca	8150	19	15.50	2026-01-11 04:54:56.163422	15.50	1.0	15.50	{"rec": 2, "fg_att": 0, "rec_td": 1, "rec_yd": 18, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 0, "rush_yd": 57, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
8d7bd992-3cf7-4403-859a-0636bbac7ef5	a08d1c9e-6070-4f64-a674-0a56a35ec792	LAR	19	6.00	2026-01-11 04:54:56.865048	6.00	1.0	6.00	{"def_td": 0, "def_int": 2, "def_sack": 3, "def_block": 0, "def_ret_td": 0, "def_safety": 0, "def_fum_rec": 0, "def_pts_allowed": 31}
e7083658-b998-4127-ba8b-1fcb5502f7b7	336f1ecd-1b0f-42bf-af7f-3eb066b2ea35	2747	19	0.00	2026-01-11 04:54:57.282891	0.00	1.0	0.00	{"fg_made": 0, "xp_made": 0}
2efcd97c-3bb9-46f4-b2c6-ef7147ac43ec	e5274a58-b24c-45fb-ad7b-711af3d66ea7	8150	19	15.50	2026-01-11 04:54:57.428945	15.50	1.0	15.50	{"rec": 2, "fg_att": 0, "rec_td": 1, "rec_yd": 18, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 0, "rush_yd": 57, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
5cb4fe92-1d07-4afd-b7bc-47ce799e65bd	5f31df4f-f1be-4f82-a75e-006323f102d3	4217	19	0.00	2026-01-11 04:54:55.410091	0.00	1.0	0.00	{}
1780a4e1-b380-4f0d-ae21-b2c11af8f49b	672ac17e-17d2-4773-a623-07026cd98aca	5022	19	0.00	2026-01-11 04:54:56.416203	0.00	1.0	0.00	{}
04d5522b-208f-4dd2-9723-57b3c27194cd	336f1ecd-1b0f-42bf-af7f-3eb066b2ea35	11563	19	0.00	2026-01-11 04:54:57.001902	0.00	1.0	0.00	{}
7364317c-d807-4570-a24e-62a2aa51f853	336f1ecd-1b0f-42bf-af7f-3eb066b2ea35	9488	19	0.00	2026-01-11 04:54:57.137664	0.00	1.0	0.00	{}
d9f21d40-4e5c-4d0f-a60a-f0cba5a8ae45	f99caf13-0faa-495d-b6d5-1366104cfb6c	11631	19	0.00	2026-01-11 04:54:55.875335	0.00	1.0	0.00	{}
69f36c91-a618-4194-9b8b-f3383fffa332	3949b108-442c-4bac-b5c9-3dada8fc19b4	5045	19	0.00	2026-01-11 04:54:58.835862	0.00	1.0	0.00	{}
55ebc8c5-ff04-40f9-84a7-a649ae52c9f8	eec1354b-3990-419b-9109-e29562821c54	8150	19	15.50	2026-01-11 04:54:58.908808	15.50	1.0	15.50	{"rec": 2, "fg_att": 0, "rec_td": 1, "rec_yd": 18, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 0, "rush_yd": 57, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
565766fe-d729-4508-b9e7-6df9c8263bb8	d56a5f4d-ca57-438b-b2e6-44ab8f51e142	7543	19	0.00	2026-01-11 04:54:58.965786	0.00	1.0	0.00	{}
28e733e9-dc33-4e7d-a375-73dbdb7e862b	d56a5f4d-ca57-438b-b2e6-44ab8f51e142	9488	19	0.00	2026-01-11 04:54:59.009063	0.00	1.0	0.00	{}
97219ef3-7410-4fe6-98e8-96516b8723c4	d56a5f4d-ca57-438b-b2e6-44ab8f51e142	7523	19	0.00	2026-01-11 04:54:59.098621	0.00	1.0	0.00	{}
144b0e83-9f17-411d-bcf1-4fa9f3343fc2	6c600817-b75f-49d3-8eb3-92b9b4849018	9493	19	34.50	2026-01-11 04:54:59.169484	34.50	1.0	34.50	{"rec": 10, "fg_att": 0, "rec_td": 1, "rec_yd": 111, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 1, "rush_yd": 14, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
e88d6937-748c-42ae-9513-ee34b5fd8d00	f1f4ea45-5e97-4f49-8e3a-69f307c30f16	4217	19	0.00	2026-01-11 04:54:59.209367	0.00	1.0	0.00	{}
ec4f7c76-88b0-4224-a864-709350538401	f1f4ea45-5e97-4f49-8e3a-69f307c30f16	12713	19	0.00	2026-01-11 04:54:59.246914	0.00	1.0	0.00	{"fg_made": 0, "xp_made": 0}
242dbd59-dc0a-4856-b199-b71593c0770a	817cf03b-a6c5-4fef-bb3d-825f6bb52c4d	421	19	22.16	2026-01-11 04:54:59.269231	22.16	1.0	22.16	{"rec": 0, "fg_att": 0, "rec_td": 0, "rec_yd": 0, "xp_att": 0, "fg_made": 0, "pass_td": 3, "pass_yd": 304, "rec_2pt": 0, "rush_td": 0, "rush_yd": 0, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 1, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
2d3050f2-b8de-4de6-93d5-919de3e7f16b	d56a5f4d-ca57-438b-b2e6-44ab8f51e142	9480	19	0.00	2026-01-11 04:54:59.360219	0.00	1.0	0.00	{}
bb907c3a-8181-4153-a34a-24dd244f062e	3949b108-442c-4bac-b5c9-3dada8fc19b4	3678	19	0.00	2026-01-11 04:54:57.812537	0.00	1.0	0.00	{"fg_made": 0, "xp_made": 0}
59527f67-945a-42bb-a90b-cb0206f55ec2	eec1354b-3990-419b-9109-e29562821c54	7569	19	0.00	2026-01-11 04:54:57.929852	0.00	1.0	0.00	{}
2f4cd3bd-a157-409e-aa23-44ea28f807dd	eec1354b-3990-419b-9109-e29562821c54	2133	19	12.20	2026-01-11 04:54:58.155116	12.20	1.0	12.20	{"rec": 5, "fg_att": 0, "rec_td": 0, "rec_yd": 72, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 0, "rush_yd": 0, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
8f5100ad-0e71-4a04-9332-e309d09a4b67	eec1354b-3990-419b-9109-e29562821c54	5001	19	0.00	2026-01-11 04:54:58.200465	0.00	1.0	0.00	{}
a9c6c6f3-88e0-44e1-b0bb-a9aa8ec58c9a	eec1354b-3990-419b-9109-e29562821c54	12474	19	0.00	2026-01-11 04:54:58.243517	0.00	1.0	0.00	{}
6ab2bd98-6d1f-45ff-83e2-785d32436a76	c8c1784c-60e4-4b3d-8efa-7c9fe81aa066	4866	19	0.00	2026-01-11 04:54:58.301815	0.00	1.0	0.00	{}
5292036e-972c-402b-83e8-d610b574a127	c8c1784c-60e4-4b3d-8efa-7c9fe81aa066	4177	19	0.00	2026-01-11 04:54:58.349589	0.00	1.0	0.00	{}
c88d18b9-d718-4a9c-a61d-b4f9a10196f8	c8c1784c-60e4-4b3d-8efa-7c9fe81aa066	5859	19	0.00	2026-01-11 04:54:58.39663	0.00	1.0	0.00	{}
87a9994a-faa5-41a4-8f1e-59f7d7ae2aed	c8c1784c-60e4-4b3d-8efa-7c9fe81aa066	5022	19	0.00	2026-01-11 04:54:58.438719	0.00	1.0	0.00	{}
5dc89265-4126-49f7-b7b4-a7e26524744f	c8c1784c-60e4-4b3d-8efa-7c9fe81aa066	12713	19	0.00	2026-01-11 04:54:58.509308	0.00	1.0	0.00	{"fg_made": 0, "xp_made": 0}
f38738cf-bb9b-4fd0-8d3c-c1792f8ecb58	eec1354b-3990-419b-9109-e29562821c54	9493	19	34.50	2026-01-11 04:54:58.57065	34.50	1.0	34.50	{"rec": 10, "fg_att": 0, "rec_td": 1, "rec_yd": 111, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 1, "rush_yd": 14, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
761a87e8-8419-4f13-8f04-420c10a3c25f	3949b108-442c-4bac-b5c9-3dada8fc19b4	11563	19	0.00	2026-01-11 04:54:58.622422	0.00	1.0	0.00	{}
f55f154b-08fb-4123-a1f0-6bc5694fcd37	3949b108-442c-4bac-b5c9-3dada8fc19b4	6869	19	0.00	2026-01-11 04:54:58.693268	0.00	1.0	0.00	{}
64238ed2-730d-483d-ad49-70f4ea57914f	3949b108-442c-4bac-b5c9-3dada8fc19b4	12489	19	0.00	2026-01-11 04:54:58.751149	0.00	1.0	0.00	{}
b23857b4-43c2-40f7-be5a-8d98478f2be5	3949b108-442c-4bac-b5c9-3dada8fc19b4	8151	19	0.00	2026-01-11 04:54:58.798391	0.00	1.0	0.00	{}
9528ffc7-eac8-4576-ac88-a927eaba2085	3949b108-442c-4bac-b5c9-3dada8fc19b4	11627	19	0.00	2026-01-11 04:54:58.903611	0.00	1.0	0.00	{}
6224f0f0-5b9e-4a50-8241-a504aa25b1c9	d56a5f4d-ca57-438b-b2e6-44ab8f51e142	11786	19	0.00	2026-01-11 04:54:59.050488	0.00	1.0	0.00	{"fg_made": 0, "xp_made": 0}
64346a42-4d50-43f4-9aa1-534a9ad8522f	d56a5f4d-ca57-438b-b2e6-44ab8f51e142	9493	19	34.50	2026-01-11 04:54:59.106287	34.50	1.0	34.50	{"rec": 10, "fg_att": 0, "rec_td": 1, "rec_yd": 111, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 1, "rush_yd": 14, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
fa92209e-2e3a-440e-8ae8-f2ab41a071f0	f1f4ea45-5e97-4f49-8e3a-69f307c30f16	2133	19	12.20	2026-01-11 04:54:59.175217	12.20	1.0	12.20	{"rec": 5, "fg_att": 0, "rec_td": 0, "rec_yd": 72, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 0, "rush_yd": 0, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
a4a7e8c5-17e7-45a5-8de0-9ef91d622e7c	d56a5f4d-ca57-438b-b2e6-44ab8f51e142	9487	19	0.00	2026-01-11 04:54:59.306553	0.00	1.0	0.00	{}
e22b6434-a3a9-421c-b6a3-0b2a95102ae4	817cf03b-a6c5-4fef-bb3d-825f6bb52c4d	2133	19	12.20	2026-01-11 04:54:59.310865	12.20	1.0	12.20	{"rec": 5, "fg_att": 0, "rec_td": 0, "rec_yd": 72, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 0, "rush_yd": 0, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
1ebd813e-8c83-41c5-9f2e-954bf60ded3d	e5274a58-b24c-45fb-ad7b-711af3d66ea7	8134	19	0.00	2026-01-11 04:54:57.515148	0.00	1.0	0.00	{}
c92eaadd-6fae-43ef-ad7c-e0bff337eb79	6c600817-b75f-49d3-8eb3-92b9b4849018	11786	19	0.00	2026-01-11 04:54:57.988917	0.00	1.0	0.00	{"fg_made": 0, "xp_made": 0}
1d151ec1-c69e-474e-bd5f-e8293ab9a763	d56a5f4d-ca57-438b-b2e6-44ab8f51e142	8151	19	0.00	2026-01-11 04:54:58.100479	0.00	1.0	0.00	{}
62fdb7fd-885d-458a-857e-072fb6d593d9	96894153-2d54-4b2e-9553-b9e866fd9db3	5022	19	0.00	2026-01-11 04:54:59.451037	0.00	1.0	0.00	{}
5a5eb724-5ef6-431b-957e-04a1e84a0743	817cf03b-a6c5-4fef-bb3d-825f6bb52c4d	12015	19	11.00	2026-01-11 04:54:59.553307	11.00	1.0	11.00	{"rec": 0, "fg_att": 2, "rec_td": 0, "rec_yd": 0, "xp_att": 4, "fg_made": 2, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 0, "rush_yd": 0, "xp_made": 4, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 46}
7ded2e7d-fe81-4a58-a4fd-f902de7db2e1	817cf03b-a6c5-4fef-bb3d-825f6bb52c4d	LAR	19	6.00	2026-01-11 04:54:59.808533	6.00	1.0	6.00	{"def_td": 0, "def_int": 2, "def_sack": 3, "def_block": 0, "def_ret_td": 0, "def_safety": 0, "def_fum_rec": 0, "def_pts_allowed": 31}
d96ce904-9107-42e3-9d4a-c5090e69cc6f	6c600817-b75f-49d3-8eb3-92b9b4849018	7523	19	0.00	2026-01-11 04:54:59.907829	0.00	1.0	0.00	{}
b31e4739-76f3-4659-b1dd-f54c4b3eb5ad	6c600817-b75f-49d3-8eb3-92b9b4849018	4034	19	0.00	2026-01-11 04:55:00.056537	0.00	1.0	0.00	{}
e00dbdeb-cd8a-4330-b8e6-4f8f5c33dbf0	8dbba58f-a902-46c5-acdd-367ebe5822e8	4866	19	0.00	2026-01-11 04:55:00.323056	0.00	1.0	0.00	{}
d0bbd4d2-b48e-4afb-af3b-98fa797e4c8a	8dbba58f-a902-46c5-acdd-367ebe5822e8	5859	19	0.00	2026-01-11 04:55:00.532873	0.00	1.0	0.00	{}
7ada34cb-a33a-4a00-93b4-35b6575e2d49	8dbba58f-a902-46c5-acdd-367ebe5822e8	12713	19	0.00	2026-01-11 04:55:00.690185	0.00	1.0	0.00	{"fg_made": 0, "xp_made": 0}
15be2b48-9ee9-4e7d-82a9-41a7bc4c705c	4cd229d9-1f32-451c-9244-45ae08835419	4984	19	0.00	2026-01-11 04:55:00.765948	0.00	1.0	0.00	{}
a220fa80-04fe-4b5b-a25d-3c5bf9c82f3b	4cd229d9-1f32-451c-9244-45ae08835419	2133	19	12.20	2026-01-11 04:55:00.886218	12.20	1.0	12.20	{"rec": 5, "fg_att": 0, "rec_td": 0, "rec_yd": 72, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 0, "rush_yd": 0, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
ff3b73db-70ea-47c1-9f73-0a28bdd02e30	4cd229d9-1f32-451c-9244-45ae08835419	4217	19	0.00	2026-01-11 04:55:01.038464	0.00	1.0	0.00	{}
da9fec07-7b20-4dc4-9f7b-8ba3777cf502	be53f692-990b-4ae6-b061-65753d22fb31	4034	19	0.00	2026-01-11 04:54:48.717481	0.00	1.0	0.00	{}
d58876fc-127d-4052-888d-2997b69c0a39	c6d87896-425c-4b88-8660-d0f0e532bdae	9493	19	34.50	2026-01-11 04:54:50.236568	34.50	1.0	34.50	{"rec": 10, "fg_att": 0, "rec_td": 1, "rec_yd": 111, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 1, "rush_yd": 14, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
39ead9da-142b-4f37-acac-1b71ecd562e3	0477bff2-c2e4-45e2-a00b-225df2154d96	9493	19	34.50	2026-01-11 04:54:50.830013	34.50	1.0	34.50	{"rec": 10, "fg_att": 0, "rec_td": 1, "rec_yd": 111, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 1, "rush_yd": 14, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
f9d23346-d97a-43a2-ac3a-15d0224ce782	cf84e9bf-0c2c-4237-9768-9828ea922861	3451	19	0.00	2026-01-11 04:54:52.618917	0.00	1.0	0.00	{"fg_made": 0, "xp_made": 0}
f6607a6c-3322-4cde-93e7-81a17c0c6f59	96894153-2d54-4b2e-9553-b9e866fd9db3	5859	19	0.00	2026-01-11 04:54:59.409833	0.00	1.0	0.00	{}
a769fc05-c7de-4abb-a439-efe3993a578d	e3692b76-bcc0-429b-ae4c-cc41b4802cd8	11638	19	0.00	2026-01-11 04:54:50.826292	0.00	1.0	0.00	{}
8be4c475-a01c-44eb-9bb9-53e37fb83d40	cf84e9bf-0c2c-4237-9768-9828ea922861	LAR	19	6.00	2026-01-11 04:54:52.875373	6.00	1.0	6.00	{"def_td": 0, "def_int": 2, "def_sack": 3, "def_block": 0, "def_ret_td": 0, "def_safety": 0, "def_fum_rec": 0, "def_pts_allowed": 31}
806101d7-2f5d-4bd9-8d9d-e85b55df2f56	817cf03b-a6c5-4fef-bb3d-825f6bb52c4d	4866	19	0.00	2026-01-11 04:54:59.866206	0.00	1.0	0.00	{}
ce8de096-251b-4561-bc1e-09549690b090	6c600817-b75f-49d3-8eb3-92b9b4849018	5850	19	6.80	2026-01-11 04:54:59.914159	6.80	1.0	6.80	{"rec": 1, "fg_att": 0, "rec_td": 0, "rec_yd": 3, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 0, "rush_yd": 55, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
9850c01d-1317-410a-9cd3-562441eca3d3	6c600817-b75f-49d3-8eb3-92b9b4849018	5859	19	0.00	2026-01-11 04:54:59.977252	0.00	1.0	0.00	{}
5c0ae13b-383b-4a11-a8d0-9597da257972	6c600817-b75f-49d3-8eb3-92b9b4849018	3214	19	0.00	2026-01-11 04:55:00.122322	0.00	1.0	0.00	{}
54142308-a60f-445b-9d41-0ced124a1fcc	8dbba58f-a902-46c5-acdd-367ebe5822e8	12529	19	0.00	2026-01-11 04:55:00.382254	0.00	1.0	0.00	{}
2e852967-a128-48be-96ee-881fc5611c77	8dbba58f-a902-46c5-acdd-367ebe5822e8	2449	19	0.00	2026-01-11 04:55:00.586176	0.00	1.0	0.00	{}
2e9e23d3-4fa7-4900-9e81-4deb2d696e42	4cd229d9-1f32-451c-9244-45ae08835419	4866	19	0.00	2026-01-11 04:55:00.813948	0.00	1.0	0.00	{}
b34c344e-ac92-4277-b80e-2f104cab52f7	4cd229d9-1f32-451c-9244-45ae08835419	9488	19	0.00	2026-01-11 04:55:00.923729	0.00	1.0	0.00	{}
ba296508-c325-479b-97a2-b0787f3e94e9	4cd229d9-1f32-451c-9244-45ae08835419	11786	19	0.00	2026-01-11 04:55:01.109087	0.00	1.0	0.00	{"fg_made": 0, "xp_made": 0}
db666843-d134-472f-b508-8990098de216	cf84e9bf-0c2c-4237-9768-9828ea922861	9493	19	34.50	2026-01-11 04:54:52.432993	34.50	1.0	34.50	{"rec": 10, "fg_att": 0, "rec_td": 1, "rec_yd": 111, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 1, "rush_yd": 14, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
cf9c09f7-6642-4abd-820a-6407e7c313e3	817cf03b-a6c5-4fef-bb3d-825f6bb52c4d	5022	19	0.00	2026-01-11 04:54:59.491522	0.00	1.0	0.00	{}
cae4a743-9916-4a31-8ccf-0791cbf0fa60	8dbba58f-a902-46c5-acdd-367ebe5822e8	11564	19	0.00	2026-01-11 04:55:00.243602	0.00	1.0	0.00	{}
eddd9f26-87ff-4147-9410-f501b40fb5f7	8dbba58f-a902-46c5-acdd-367ebe5822e8	7525	19	0.00	2026-01-11 04:55:00.480513	0.00	1.0	0.00	{}
530573c4-509d-49c8-9192-8176d9585212	8dbba58f-a902-46c5-acdd-367ebe5822e8	3214	19	0.00	2026-01-11 04:55:00.632886	0.00	1.0	0.00	{}
d51be074-a257-475e-8109-22b499339e6b	4cd229d9-1f32-451c-9244-45ae08835419	8151	19	0.00	2026-01-11 04:55:00.878084	0.00	1.0	0.00	{}
5093c010-7f01-4b19-8b35-d188744840c7	cf84e9bf-0c2c-4237-9768-9828ea922861	12526	19	13.10	2026-01-11 04:54:52.50226	13.10	1.0	13.10	{"rec": 5, "fg_att": 0, "rec_td": 0, "rec_yd": 81, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 0, "rush_yd": 0, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
283ceb0b-f1ba-4246-a6d9-5dca3302b11e	817cf03b-a6c5-4fef-bb3d-825f6bb52c4d	9487	19	0.00	2026-01-11 04:54:59.533541	0.00	1.0	0.00	{}
158eb0c7-9ba9-4f56-aef3-854fa38af316	78228a8f-0563-44b2-bee2-1db1699c6cd9	9493	19	34.50	2026-01-11 04:54:48.24575	34.50	1.0	34.50	{"rec": 10, "fg_att": 0, "rec_td": 1, "rec_yd": 111, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 1, "rush_yd": 14, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
8eca0b21-90ac-4d31-a101-0f34593769da	672ac17e-17d2-4773-a623-07026cd98aca	421	19	22.16	2026-01-11 04:54:56.155479	22.16	1.0	22.16	{"rec": 0, "fg_att": 0, "rec_td": 0, "rec_yd": 0, "xp_att": 0, "fg_made": 0, "pass_td": 3, "pass_yd": 304, "rec_2pt": 0, "rush_td": 0, "rush_yd": 0, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 1, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
526cdb5c-9edc-4230-8713-29a4442bde56	817cf03b-a6c5-4fef-bb3d-825f6bb52c4d	8150	19	15.50	2026-01-11 04:54:59.367265	15.50	1.0	15.50	{"rec": 2, "fg_att": 0, "rec_td": 1, "rec_yd": 18, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 0, "rush_yd": 57, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
7067c594-4bd8-49a6-a78b-68237e4de0be	f99caf13-0faa-495d-b6d5-1366104cfb6c	11586	19	7.80	2026-01-11 04:54:49.59938	7.80	1.0	7.80	{"rec": 2, "fg_att": 0, "rec_td": 0, "rec_yd": 13, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 0, "rush_yd": 45, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
f455dfe0-4943-46dd-b8a5-a7751c67fd11	a08d1c9e-6070-4f64-a674-0a56a35ec792	421	19	22.16	2026-01-11 04:54:53.688543	22.16	1.0	22.16	{"rec": 0, "fg_att": 0, "rec_td": 0, "rec_yd": 0, "xp_att": 0, "fg_made": 0, "pass_td": 3, "pass_yd": 304, "rec_2pt": 0, "rush_td": 0, "rush_yd": 0, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 1, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
6bed6fbb-0183-426a-85b2-525178c3f1a6	e5274a58-b24c-45fb-ad7b-711af3d66ea7	LAR	19	6.00	2026-01-11 04:54:57.768567	6.00	1.0	6.00	{"def_td": 0, "def_int": 2, "def_sack": 3, "def_block": 0, "def_ret_td": 0, "def_safety": 0, "def_fum_rec": 0, "def_pts_allowed": 31}
ee8fbfb7-aa31-40a1-a6a3-36968117ccd6	c8c1784c-60e4-4b3d-8efa-7c9fe81aa066	9493	19	34.50	2026-01-11 04:54:58.449231	34.50	1.0	34.50	{"rec": 10, "fg_att": 0, "rec_td": 1, "rec_yd": 111, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 1, "rush_yd": 14, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
9a8cfb69-8d0a-41d4-bba0-6caa30666186	817cf03b-a6c5-4fef-bb3d-825f6bb52c4d	9493	19	34.50	2026-01-11 04:54:59.539584	34.50	1.0	34.50	{"rec": 10, "fg_att": 0, "rec_td": 1, "rec_yd": 111, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 1, "rush_yd": 14, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
8d0166fc-d23f-4822-b7a9-a87db6ecc8b5	e89cb6a2-d04a-44a1-878e-3f70304f3383	3451	19	0.00	2026-01-11 04:54:47.933079	0.00	1.0	0.00	{"fg_made": 0, "xp_made": 0}
5400282b-2089-4ab0-a9f0-50668e478fe4	be53f692-990b-4ae6-b061-65753d22fb31	9493	19	34.50	2026-01-11 04:54:48.721571	34.50	1.0	34.50	{"rec": 10, "fg_att": 0, "rec_td": 1, "rec_yd": 111, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 1, "rush_yd": 14, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
79186a3f-2507-47bf-a877-51dd1d9af089	96894153-2d54-4b2e-9553-b9e866fd9db3	9493	19	34.50	2026-01-11 04:54:49.042992	34.50	1.0	34.50	{"rec": 10, "fg_att": 0, "rec_td": 1, "rec_yd": 111, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 1, "rush_yd": 14, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
ed9a0aba-0303-478a-a159-07ed30e72726	f1f4ea45-5e97-4f49-8e3a-69f307c30f16	9493	19	34.50	2026-01-11 04:54:54.438529	34.50	1.0	34.50	{"rec": 10, "fg_att": 0, "rec_td": 1, "rec_yd": 111, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 1, "rush_yd": 14, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
29064aff-8d11-4564-bae7-694c69fea903	5f31df4f-f1be-4f82-a75e-006323f102d3	8150	19	15.50	2026-01-11 04:54:55.250595	15.50	1.0	15.50	{"rec": 2, "fg_att": 0, "rec_td": 1, "rec_yd": 18, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 0, "rush_yd": 57, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
36660c9e-b03e-4df4-a9f5-c1e9396d6241	3d0e444e-55af-4dd6-bea8-f7959efca74c	9493	19	34.50	2026-01-11 04:54:47.493302	34.50	1.0	34.50	{"rec": 10, "fg_att": 0, "rec_td": 1, "rec_yd": 111, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 1, "rush_yd": 14, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
b0192fb2-2d9c-49fa-9c3f-a35cff321a13	96894153-2d54-4b2e-9553-b9e866fd9db3	8150	19	15.50	2026-01-11 04:54:56.590607	15.50	1.0	15.50	{"rec": 2, "fg_att": 0, "rec_td": 1, "rec_yd": 18, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 0, "rush_yd": 57, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
60d241e2-32c1-4304-a1c5-e20f1ed88261	b1abaca0-b950-4f59-a54b-4d9bf54b9d0f	12526	19	13.10	2026-01-11 04:54:48.343139	13.10	1.0	13.10	{"rec": 5, "fg_att": 0, "rec_td": 0, "rec_yd": 81, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 0, "rush_yd": 0, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
663c9ac6-0e54-4885-ab40-9840d6e0b5a4	b1abaca0-b950-4f59-a54b-4d9bf54b9d0f	9493	19	34.50	2026-01-11 04:54:48.367232	34.50	1.0	34.50	{"rec": 10, "fg_att": 0, "rec_td": 1, "rec_yd": 111, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 1, "rush_yd": 14, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
50ec9f77-3cf2-4a9d-9ead-764f04cbd47a	eec1354b-3990-419b-9109-e29562821c54	12015	19	11.00	2026-01-11 04:54:58.138956	11.00	1.0	11.00	{"rec": 0, "fg_att": 2, "rec_td": 0, "rec_yd": 0, "xp_att": 4, "fg_made": 2, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 0, "rush_yd": 0, "xp_made": 4, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 46}
e61cd9c3-2056-4989-b5b1-832a7c20de41	7bc28e3c-d2a2-4a70-b5a4-6d65eff6e757	3271	19	6.50	2026-01-11 04:54:49.204667	6.50	1.0	6.50	{"rec": 2, "fg_att": 0, "rec_td": 0, "rec_yd": 45, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 0, "rush_yd": 0, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
b1c058af-9663-4f98-b179-e756ed8d9a02	c05554c7-c311-43c6-a070-40cb889e840a	GB	19	9.00	2026-01-11 04:54:47.269056	9.00	1.0	9.00	{"def_td": 0, "def_int": 4, "def_sack": 2, "def_block": 0, "def_ret_td": 0, "def_safety": 0, "def_fum_rec": 0, "def_pts_allowed": 31}
0c1849ff-2c1f-464f-aeb9-a05c60a9581c	e89cb6a2-d04a-44a1-878e-3f70304f3383	7694	19	5.20	2026-01-11 04:54:47.755968	5.20	1.0	5.20	{"rec": 3, "fg_att": 0, "rec_td": 0, "rec_yd": 22, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 0, "rush_yd": 0, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
16f1bbd7-8b8e-4e03-9f09-eff755d6027b	b25714c1-8c53-4a27-9bb2-110b8f68d4c8	9493	19	34.50	2026-01-11 04:54:51.460536	34.50	1.0	34.50	{"rec": 10, "fg_att": 0, "rec_td": 1, "rec_yd": 111, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 1, "rush_yd": 14, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
84a4f2df-eecc-4936-8d75-c30878c07a11	eec1354b-3990-419b-9109-e29562821c54	421	19	22.16	2026-01-11 04:54:58.564126	22.16	1.0	22.16	{"rec": 0, "fg_att": 0, "rec_td": 0, "rec_yd": 0, "xp_att": 0, "fg_made": 0, "pass_td": 3, "pass_yd": 304, "rec_2pt": 0, "rush_td": 0, "rush_yd": 0, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 1, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
77adc653-aec4-4418-8dd8-1975494d20a0	4cd229d9-1f32-451c-9244-45ae08835419	12526	19	13.10	2026-01-11 04:55:00.994173	13.10	1.0	13.10	{"rec": 5, "fg_att": 0, "rec_td": 0, "rec_yd": 81, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 0, "rush_yd": 0, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
65f6e5d6-50c2-4f91-a48c-c1ce52931453	e89cb6a2-d04a-44a1-878e-3f70304f3383	6790	19	17.20	2026-01-11 04:54:47.743918	17.20	1.0	17.20	{"rec": 2, "fg_att": 0, "rec_td": 0, "rec_yd": 38, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 1, "rush_yd": 54, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
86fcfdc0-b9b9-40e1-8da9-cf1712d9f566	e89cb6a2-d04a-44a1-878e-3f70304f3383	8121	19	26.40	2026-01-11 04:54:47.811926	26.40	1.0	26.40	{"rec": 8, "fg_att": 0, "rec_td": 1, "rec_yd": 124, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 0, "rush_yd": 0, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
19fccae8-7256-4adf-ab37-3607ad8cf497	b1abaca0-b950-4f59-a54b-4d9bf54b9d0f	12015	19	11.00	2026-01-11 04:54:48.471408	11.00	1.0	11.00	{"rec": 0, "fg_att": 2, "rec_td": 0, "rec_yd": 0, "xp_att": 4, "fg_made": 2, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 0, "rush_yd": 0, "xp_made": 4, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 46}
06981ee7-e306-4982-92ec-ebb59c03f20a	6c600817-b75f-49d3-8eb3-92b9b4849018	8167	19	12.60	2026-01-11 04:54:59.988465	12.60	1.0	12.60	{"rec": 3, "fg_att": 0, "rec_td": 1, "rec_yd": 36, "xp_att": 0, "fg_made": 0, "pass_td": 0, "pass_yd": 0, "rec_2pt": 0, "rush_td": 0, "rush_yd": 0, "xp_made": 0, "fum_lost": 0, "pass_2pt": 0, "pass_int": 0, "rush_2pt": 0, "fg_missed": 0, "xp_missed": 0, "fg_longest": 0}
\.


--
-- Data for Name: scoring_rules; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.scoring_rules (id, category, stat_name, points, description, is_active, display_order, created_at, updated_at) FROM stdin;
154	passing	pass_yd	0.04	1 point per 25 passing yards	t	1	2025-11-02 21:21:28.96082	2025-11-02 21:21:28.96082
155	passing	pass_td	4.00	4 points per passing TD	t	2	2025-11-02 21:21:28.96082	2025-11-02 21:21:28.96082
156	passing	pass_int	-2.00	-2 points per interception	t	3	2025-11-02 21:21:28.96082	2025-11-02 21:21:28.96082
157	passing	pass_2pt	2.00	2 points per 2-pt conversion	t	4	2025-11-02 21:21:28.96082	2025-11-02 21:21:28.96082
158	rushing	rush_yd	0.10	1 point per 10 rushing yards	t	10	2025-11-02 21:21:28.96082	2025-11-02 21:21:28.96082
159	rushing	rush_td	6.00	6 points per rushing TD	t	11	2025-11-02 21:21:28.96082	2025-11-02 21:21:28.96082
160	rushing	rush_2pt	2.00	2 points per 2-pt conversion	t	12	2025-11-02 21:21:28.96082	2025-11-02 21:21:28.96082
163	receiving	rec_td	6.00	6 points per receiving TD	t	22	2025-11-02 21:21:28.96082	2025-11-02 21:21:28.96082
164	receiving	rec_2pt	2.00	2 points per 2-pt conversion	t	23	2025-11-02 21:21:28.96082	2025-11-02 21:21:28.96082
165	special	fum_lost	-2.00	-2 points per fumble lost	t	30	2025-11-02 21:21:28.96082	2025-11-02 21:21:28.96082
166	special	fum_rec_td	6.00	6 points for fumble recovery TD	t	31	2025-11-02 21:21:28.96082	2025-11-02 21:21:28.96082
167	kicking	fgm_0_19	3.00	3 points for FG 0-19 yards	t	40	2025-11-02 21:21:28.96082	2025-11-02 21:21:28.96082
168	kicking	fgm_20_29	3.00	3 points for FG 20-29 yards	t	41	2025-11-02 21:21:28.96082	2025-11-02 21:21:28.96082
169	kicking	fgm_30_39	3.00	3 points for FG 30-39 yards	t	42	2025-11-02 21:21:28.96082	2025-11-02 21:21:28.96082
170	kicking	fgm_40_49	4.00	4 points for FG 40-49 yards	t	43	2025-11-02 21:21:28.96082	2025-11-02 21:21:28.96082
171	kicking	fgm_50p	5.00	5 points for FG 50+ yards	t	44	2025-11-02 21:21:28.96082	2025-11-02 21:21:28.96082
172	kicking	fgmiss	-1.00	-1 point for missed FG	t	45	2025-11-02 21:21:28.96082	2025-11-02 21:21:28.96082
173	kicking	xpm	1.00	1 point per extra point	t	46	2025-11-02 21:21:28.96082	2025-11-02 21:21:28.96082
174	kicking	xpmiss	-1.00	-1 point for missed XP	t	47	2025-11-02 21:21:28.96082	2025-11-02 21:21:28.96082
175	defense	def_td	6.00	6 points per defensive TD	t	50	2025-11-02 21:21:28.96082	2025-11-02 21:21:28.96082
176	defense	def_int	2.00	2 points per interception	t	51	2025-11-02 21:21:28.96082	2025-11-02 21:21:28.96082
177	defense	def_fum_rec	2.00	2 points per fumble recovery	t	52	2025-11-02 21:21:28.96082	2025-11-02 21:21:28.96082
178	defense	def_sack	1.00	1 point per sack	t	53	2025-11-02 21:21:28.96082	2025-11-02 21:21:28.96082
179	defense	def_safety	2.00	2 points per safety	t	54	2025-11-02 21:21:28.96082	2025-11-02 21:21:28.96082
161	receiving	rec	1.00	1 point per reception (PPR)	t	20	2025-11-02 21:21:28.96082	2025-12-02 04:24:41.765718
162	receiving	rec_yd	0.10	1 point per 10 receiving yards	t	21	2025-11-02 21:21:28.96082	2025-12-02 04:24:41.813621
\.


--
-- Data for Name: signup_attempts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.signup_attempts (id, apple_id, email, name, attempted_state, ip_state_verified, blocked, blocked_reason, attempted_at) FROM stdin;
1	001282.73db0edd090e43e8be81d4d56f108938.0243	\N	\N	TX	TX	f	\N	2025-12-13 01:14:08.585001
2	001282.73db0edd090e43e8be81d4d56f108938.0243	\N	\N	TX	TX	f	\N	2025-12-13 03:12:28.403303
3	\N	test@test.com	\N	TX	TX	f	\N	2025-12-13 14:46:51.061554
4	\N	test@test.com	\N	TX	TX	f	\N	2025-12-13 14:49:05.827597
5	\N	test@test.com	Patty Sandwich	TX	TX	f	\N	2025-12-13 14:56:36.010094
6	\N	test@test.com	Tester	TX	TX	f	\N	2025-12-13 15:07:15.50996
7	001586.82f4fa3a2f2445f8b0b965debc285a01.1942	\N	\N	TX	TX	f	\N	2025-12-13 16:50:20.356377
8	\N	test@test.com	\N	TX	TX	f	\N	2025-12-13 22:14:50.71556
9	\N	test@test.com	\N	TX	TX	f	\N	2025-12-13 22:27:35.739393
10	\N	test@test.com	\N	UT	TX	f	\N	2025-12-13 23:06:40.760515
11	000710.1761dbd3b52e477ba3629bfb6552a5a6.1711	\N	\N	TX	TX	f	\N	2025-12-13 23:12:45.410724
12	\N	testian@test.com	\N	TX	TX	f	\N	2025-12-13 23:29:46.120096
13	\N	testchad@test.com	\N	TX	TX	f	\N	2025-12-14 00:18:32.835791
14	\N	testa@testa.com	\N	TX	TX	f	\N	2025-12-17 03:55:05.035214
15	\N	testchad@test.com	\N	TX	CA	f	\N	2025-12-18 04:19:05.50567
16	\N	testb@testb@com	\N	TX	TX	f	\N	2025-12-19 19:53:16.132284
17	000486.378d8f27002e4d4581ea4f83a1171935.2353	\N	\N	TX	\N	f	\N	2025-12-20 00:50:57.30014
18	\N	testc@testc.com	\N	TX	FL	f	\N	2025-12-21 17:57:00.364373
19	\N	tommy@tom.com	\N	TX	TX	f	\N	2025-12-24 03:27:36.142023
20	\N	a@a.com	\N	TX	TX	f	\N	2025-12-24 03:57:18.419671
21	\N	b@b.com	\N	TX	TX	f	\N	2025-12-24 04:02:11.953744
22	\N	c@c.com	\N	TX	TX	f	\N	2025-12-24 04:06:00.998678
23	\N	d@d.com	\N	TX	TX	f	\N	2025-12-24 04:39:20.889741
24	\N	ht@ht.com	\N	TX	TX	f	\N	2025-12-24 06:39:27.542806
25	\N	ipad@a.com	\N	CT	TX	f	\N	2025-12-24 06:57:23.697592
26	000142.893b963efda84b919cf76438c6f19ac5.0139	rzrfd8y6z7@privaterelay.appleid.com	\N	CA	\N	f	\N	2025-12-30 01:39:34.130598
27	\N	tester@deleteme.com	\N	TX	TX	f	\N	2025-12-30 15:37:53.694352
28	\N	deleteme@d.com	\N	TX	TX	f	\N	2025-12-30 16:10:12.327452
29	001282.73db0edd090e43e8be81d4d56f108938.0243	\N	\N	TX	TX	f	\N	2025-12-30 19:30:43.626679
30	001492.ab1f4ae0cd8c4d0e9225f0b3ff903504.1018	ar_user931@icloud.com	\N	AL	L	f	\N	2026-01-05 10:19:00.125028
31	001564.ca158412be9d41589dd602ecbade6d52.1426	cameroncvrter@gmail.com	\N	TX	TX	f	\N	2026-01-05 14:27:09.220138
32	001194.cf473b71bf304d9ba30f237f59746a4b.1522	ptg7kz6wcz@privaterelay.appleid.com	\N	CA	CA	f	\N	2026-01-05 15:23:12.8476
33	000351.a1e99acb44694f0aaaa93a82599c4cf7.1526	j4cyxkqrrx@privaterelay.appleid.com	\N	TX	TX	f	\N	2026-01-05 15:26:52.906923
34	000267.ddb022d382044052b28cf1ad6bffe7e6.1705	brown.nunnt@gmail.com	\N	MI	MI	f	\N	2026-01-05 17:05:39.052769
35	000979.8040c7aab6ee4ab181a89cd874a4a4c0.0115	hernandezeddie1214@gmail.com	\N	CA	CA	f	\N	2026-01-06 01:15:49.353191
36	001940.47ed0c8d042c49f08bf7fc893695a054.0138	pm7qb6zq56@privaterelay.appleid.com	\N	TX	TX	f	\N	2026-01-06 01:39:05.030833
37	001230.f19c665ddfb24dff9dbe4538f97caea2.0244	jaxoncorreia@icloud.com	\N	AL	ON	f	\N	2026-01-06 02:45:21.199811
38	001002.8037a930ef5a4849be10c4edacfe9d6f.0250	b9kfk8w9wv@privaterelay.appleid.com	\N	TX	TX	f	\N	2026-01-06 02:51:13.241472
39	000631.081e27750d91494e9aed30e65b6abff9.0252	h8txqjjt72@privaterelay.appleid.com	\N	TX	TX	f	\N	2026-01-06 02:52:55.787557
40	001274.04ad2de7211f4cbb8cea1d9e9c5b57f2.0734	42j6fhggkr@privaterelay.appleid.com	\N	TX	TX	f	\N	2026-01-06 07:34:42.693657
41	000710.1761dbd3b52e477ba3629bfb6552a5a6.1711	\N	\N	TX	TX	f	\N	2026-01-06 17:52:22.863312
42	000175.7fb13b2747f14b45a56453d51c374d0d.2046	\N	\N	NY	CT	f	\N	2026-01-06 20:48:55.978571
43	001859.6da299e9ae264603be1ac50ea5af94ed.0119	grtgjq75d9@privaterelay.appleid.com	\N	TX	TX	f	\N	2026-01-07 01:19:50.680665
44	001282.73db0edd090e43e8be81d4d56f108938.0243	iancarter13@gmail.com	\N	TX	TX	f	\N	2026-01-07 01:19:52.19361
45	001552.b53841efcf3f418ebe2c6ea0aa18586b.0136	renpastana@hotmail.com	\N	TX	TX	f	\N	2026-01-07 01:37:07.050115
46	001271.c38f72e07eac489db014b7b76135ade0.0337	shtns76j6p@privaterelay.appleid.com	\N	TX	\N	f	\N	2026-01-07 03:38:12.221153
47	001478.b3d235cda2284db197d46f775869fd17.0345	ftsjf9cxwg@privaterelay.appleid.com	\N	TX	\N	f	\N	2026-01-07 03:46:22.421003
48	000896.1d5f6175fb274e27bcc7658b68dce97d.1422	john.pearson@atmosenergy.com	\N	TX	TX	f	\N	2026-01-07 14:22:58.803734
49	001282.73db0edd090e43e8be81d4d56f108938.0243	\N	\N	TX	TX	f	\N	2026-01-07 15:22:53.605837
50	001282.73db0edd090e43e8be81d4d56f108938.0243	\N	\N	TX	TX	f	\N	2026-01-07 15:46:44.185717
51	001282.73db0edd090e43e8be81d4d56f108938.0243	\N	\N	TX	TX	f	\N	2026-01-07 16:39:23.424815
52	000836.d7efce0709fe4888848a4251ed5b26cc.1702	xmytrgfktd@privaterelay.appleid.com	\N	TX	\N	f	\N	2026-01-07 17:02:18.801547
53	001124.7ccca051c0374e3e95fdedf326e38588.1739	curtis_niederhaus@yahoo.com	\N	TX	TX	f	\N	2026-01-07 17:39:39.742411
54	000440.e24e6a2b345b46bbbbdc74453454e874.1749	7pmv97dmk9@privaterelay.appleid.com	\N	TN	\N	f	\N	2026-01-07 17:50:58.853657
55	000306.205572ab266043948b91f060115bd4b9.1819	f7n66842qh@privaterelay.appleid.com	\N	TX	TX	f	\N	2026-01-07 18:19:10.46844
56	001898.b377599a6d714e6c8ab88957660c1c02.0013	josephcortez74@gmail.com	\N	TX	\N	f	\N	2026-01-08 00:14:14.813736
57	000017.188281ac900d4458a0fcb4e8ec43887a.0017	xzzjpcqtm7@privaterelay.appleid.com	\N	TX	TX	f	\N	2026-01-08 00:17:21.781559
58	000338.070a9b554c2e4263960f5d36550a91b1.0042	\N	\N	TX	TX	f	\N	2026-01-08 00:44:54.854727
59	001930.48b6137f44d54084bf96980f25675def.0231	mfkg5zf72n@privaterelay.appleid.com	\N	RI	RI	f	\N	2026-01-08 02:31:51.037484
60	001282.73db0edd090e43e8be81d4d56f108938.0243	\N	\N	TX	TX	f	\N	2026-01-08 04:47:37.498531
61	001365.265ff872511841149ba3ebcaad7ff749.1710	coreygunn@yahoo.com	\N	TX	\N	f	\N	2026-01-08 17:10:28.796956
62	001482.4477640601d64f24b9f7847d5d0a2dd3.1904	s5dzxwpvnf@privaterelay.appleid.com	\N	TX	TX	f	\N	2026-01-08 19:05:08.984801
63	000565.1051f90db8c54166ae79c9bed10b6090.2155	w9kyynw9jg@privaterelay.appleid.com	\N	GA	GA	f	\N	2026-01-08 21:56:11.076877
64	001239.b0ad85a2f7a249819ffd18b1ac77b454.0318	rarnold2007@windstream.net	\N	TX	CA	f	\N	2026-01-09 03:18:38.62426
65	000918.5a2dfc9f49e2470db332e44fc1897039.0453	6vv6ssnghx@privaterelay.appleid.com	\N	TX	TX	f	\N	2026-01-09 04:54:23.792598
66	001569.cef4d396f4c54c808f977e8003859630.0724	sqb2hddtrs@privaterelay.appleid.com	\N	CA	SH	f	\N	2026-01-09 07:24:43.327322
67	000887.9d6e4799f0f3483cbec65d87c6962ec0.0852	pjh828710@gmail.com	\N	OR	WA	f	\N	2026-01-09 08:53:07.067772
68	001319.f24faf111df14facbeba3c42ffad4a11.1951	4mkk7nrkvv@privaterelay.appleid.com	\N	TX	TX	f	\N	2026-01-09 19:52:05.382743
69	000403.17ed076d8c9f49eeb7532af7246fec5f.2130	7vrrbj5vcq@privaterelay.appleid.com	\N	MI	MI	f	\N	2026-01-09 21:30:23.979851
70	001009.d7b3497fb3d14874adaade2ed0ad84a5.2138	qsm5v94tpw@privaterelay.appleid.com	\N	OH	OH	f	\N	2026-01-09 21:38:37.400932
71	001904.9dd18b3488ce4979a75bd15058005769.2226	Evanpragazzi@gmail.com	\N	NJ	NJ	f	\N	2026-01-09 22:26:58.716523
72	000086.0f7b03180e0e41728c6e9d5e20e6b465.0214	qn8m92cfpg@privaterelay.appleid.com	\N	TX	TX	f	\N	2026-01-10 02:15:07.159146
73	000649.dc47bccc1fa9449f85024c9b941f26a6.0244	ashtnmcgee@gmail.com	\N	TX	TX	f	\N	2026-01-10 02:45:06.063395
74	001363.a31cd885dbe94eaebbc81a4e8785fe94.0320	qzbfk269tz@privaterelay.appleid.com	\N	VA	VA	f	\N	2026-01-10 03:21:07.977291
75	000829.e424e65e1f5348aba986cf3188a8bb6a.0336	wade@texasrp.com	\N	TX	IL	f	\N	2026-01-10 03:36:38.522454
76	000293.16df8a160f5549cfa4d9f772002980f2.0344	jakejenkins1010@yahoo.com	\N	TX	TX	f	\N	2026-01-10 03:44:31.331927
77	001271.c38f72e07eac489db014b7b76135ade0.0337	\N	\N	TX	TX	f	\N	2026-01-10 05:08:21.912557
78	001069.2d7e7e6987834f128d419f32e1537d3d.1511	d5jxssk7zh@privaterelay.appleid.com	\N	TX	TX	f	\N	2026-01-10 15:11:20.205458
79	001870.e2374b7508164f16b5319245d6b9d22c.1747	8c67jn4c6p@privaterelay.appleid.com	\N	TX	TX	f	\N	2026-01-10 17:48:15.52671
80	001213.c49c233ece2d4cf1b51e873f7962b835.1845	bwilliams_09@hotmail.com	\N	TX	TX	f	\N	2026-01-10 18:45:44.199696
81	000831.a6e3e112e34b4efc9c510125676855ac.2046	8jsn78pxy2@privaterelay.appleid.com	\N	OH	OH	f	\N	2026-01-10 20:47:32.266922
82	001891.27974d45260441d4bb530f87d2cdce61.2102	robertandrewkent@gmail.com	\N	TX	TX	f	\N	2026-01-10 21:02:56.653809
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.users (id, username, team_name, paid, payment_method, payment_date, is_admin, created_at, email, apple_id, name, updated_at, phone, state, ip_state_verified, state_certification_date, eligibility_confirmed_at, tos_version, tos_accepted_at, age_verified, password_hash, auth_method, admin_notes) FROM stdin;
3d0e444e-55af-4dd6-bea8-f7959efca74c	jaxoncorreia	\N	f	\N	\N	f	2026-01-06 02:45:21	jaxoncorreia@icloud.com	001230.f19c665ddfb24dff9dbe4538f97caea2.0244	\N	2026-01-10 04:14:55.695733	\N	AL	ON	2026-01-06 02:45:21	2026-01-06 02:45:21	2025-12-12	\N	t	\N	apple	Not Playing
e3692b76-bcc0-429b-ae4c-cc41b4802cd8	BloodySox	\N	f	\N	\N	f	2026-01-08 02:31:51.033946	mfkg5zf72n@privaterelay.appleid.com	001930.48b6137f44d54084bf96980f25675def.0231	\N	2026-01-10 16:45:09.43873	\N	RI	RI	2026-01-08 02:31:51.033946	2026-01-08 02:31:51.033946	2025-12-12	\N	t	\N	apple	\N
336f1ecd-1b0f-42bf-af7f-3eb066b2ea35	PugKween	\N	t	\N	\N	f	2026-01-10 02:45:06.058448	ashtnmcgee@gmail.com	000649.dc47bccc1fa9449f85024c9b941f26a6.0244	\N	2026-01-10 03:08:07.104783	\N	TX	TX	2026-01-10 02:45:06.058448	2026-01-10 02:45:06.058448	2025-12-17	2026-01-10 02:45:11.772448	t	\N	apple	Ashton
cf84e9bf-0c2c-4237-9768-9828ea922861	PhukaTheKing	\N	f	\N	\N	f	2026-01-09 08:53:07.06366	pjh828710@gmail.com	000887.9d6e4799f0f3483cbec65d87c6962ec0.0852	\N	2026-01-10 16:44:35.317256	\N	OR	WA	2026-01-09 08:53:07.06366	2026-01-09 08:53:07.06366	2025-12-17	2026-01-09 08:54:22.183233	t	\N	apple	\N
817cf03b-a6c5-4fef-bb3d-825f6bb52c4d	Greggo	\N	t	\N	\N	f	2026-01-09 21:30:23.976967	7vrrbj5vcq@privaterelay.appleid.com	000403.17ed076d8c9f49eeb7532af7246fec5f.2130	Greg	2026-01-10 21:20:48.187189	\N	MI	MI	2026-01-09 21:30:23.976967	2026-01-09 21:30:23.976967	2025-12-17	2026-01-09 21:30:37.437724	t	\N	apple	No Idea, but paid.
4477133e-bd55-4596-99da-8e1d6599e923	For_Kruz	\N	t	\N	\N	f	2026-01-08 00:17:21.777208	xzzjpcqtm7@privaterelay.appleid.com	000017.188281ac900d4458a0fcb4e8ec43887a.0017	\N	2026-01-10 03:07:17.890026	\N	TX	TX	2026-01-08 00:17:21.777208	2026-01-08 00:17:21.777208	2025-12-12	\N	t	\N	apple	Curtis' Friend
c6d87896-425c-4b88-8660-d0f0e532bdae	jeckyll99	\N	t	\N	\N	f	2026-01-08 00:44:54.851343	\N	000338.070a9b554c2e4263960f5d36550a91b1.0042	\N	2026-01-10 03:07:28.28134	\N	TX	TX	2026-01-08 00:44:54.851343	2026-01-08 00:44:54.851343	2025-12-12	\N	t	\N	apple	Curtis' Friend
c5abc1fc-2f96-40f7-82e6-9811a63ed7b5	CGunn	\N	t	\N	\N	f	2026-01-08 17:10:28.787957	coreygunn@yahoo.com	001365.265ff872511841149ba3ebcaad7ff749.1710	\N	2026-01-10 21:40:12.384584	\N	TX	\N	2026-01-08 17:10:28.787957	2026-01-08 17:10:28.787957	2025-12-17	2026-01-10 21:40:12.384584	t	\N	apple	Corey Gunn
d24ad709-1f34-4a5c-94c0-c3be9b11c243	redheadchicken	\N	t	\N	\N	f	2026-01-07 17:02:18.796623	xmytrgfktd@privaterelay.appleid.com	000836.d7efce0709fe4888848a4251ed5b26cc.1702	\N	2026-01-11 00:52:54.043917	\N	TX	\N	2026-01-07 17:02:18.796623	2026-01-07 17:02:18.796623	2025-12-17	2026-01-11 00:52:54.043917	t	\N	apple	Curtis' Friend
5f31df4f-f1be-4f82-a75e-006323f102d3	wade	\N	t	\N	\N	f	2026-01-10 03:36:38.518805	wade@texasrp.com	000829.e424e65e1f5348aba986cf3188a8bb6a.0336	\N	2026-01-10 04:50:59.610984	\N	TX	IL	2026-01-10 03:36:38.518805	2026-01-10 03:36:38.518805	2025-12-12	\N	t	\N	apple	Wade Blackburn
b25714c1-8c53-4a27-9bb2-110b8f68d4c8	ChaddleSnake	\N	f	\N	\N	t	2025-12-13 16:50:20	chadrmcgee@gmail.com	001586.82f4fa3a2f2445f8b0b965debc285a01.1942	\N	2026-01-10 03:11:02.901754	\N	TX	TX	2025-12-13 16:50:20	2025-12-13 16:50:20	2025-12-17	2026-01-08 04:55:06.70081	t	\N	apple	Chad McGee not playing
7ee6f115-eb0e-41fc-a672-535398c69a60	Evanpragazzi	\N	f	\N	\N	f	2026-01-09 22:26:58.713481	Evanpragazzi@gmail.com	001904.9dd18b3488ce4979a75bd15058005769.2226	\N	2026-01-10 16:44:46.107192	\N	NJ	NJ	2026-01-09 22:26:58.713481	2026-01-09 22:26:58.713481	2025-12-17	2026-01-09 22:27:15.473367	t	\N	apple	\N
1ef1b9bb-3dc0-4468-8096-b468fa428e5e	brown.nunnt	\N	f	\N	\N	f	2026-01-05 17:05:39	brown.nunnt@gmail.com	000267.ddb022d382044052b28cf1ad6bffe7e6.1705	\N	2026-01-10 16:44:51.479382	\N	MI	MI	2026-01-05 17:05:39	2026-01-05 17:05:39	2025-12-12	\N	t	\N	apple	\N
e89cb6a2-d04a-44a1-878e-3f70304f3383	renpastana	\N	f	\N	\N	f	2026-01-07 01:37:07.047877	renpastana@hotmail.com	001552.b53841efcf3f418ebe2c6ea0aa18586b.0136	\N	2026-01-10 03:57:50.516681	\N	TX	TX	2026-01-07 01:37:07.047877	2026-01-07 01:37:07.047877	2025-12-12	\N	t	\N	apple	Ren Pastana
12c17895-eec7-4885-b41f-7f5cfbd9a266	hernandezeddie1214	\N	f	\N	\N	f	2026-01-06 01:15:49.344092	hernandezeddie1214@gmail.com	000979.8040c7aab6ee4ab181a89cd874a4a4c0.0115	\N	2026-01-10 16:44:56.150625	\N	CA	CA	2026-01-06 01:15:49.344092	2026-01-06 01:15:49.344092	2025-12-12	\N	t	\N	apple	\N
68537bd1-04cc-424a-9bed-b75324336840	UofA	\N	f	\N	\N	f	2026-01-06 20:48:55.975351	\N	000175.7fb13b2747f14b45a56453d51c374d0d.2046	\N	2026-01-10 16:45:00.746311	\N	NY	CT	2026-01-06 20:48:55.975351	2026-01-06 20:48:55.975351	2025-12-12	\N	t	\N	apple	\N
a08d1c9e-6070-4f64-a674-0a56a35ec792	dmuckley	\N	t	\N	\N	f	2026-01-05 15:23:12.844699	ptg7kz6wcz@privaterelay.appleid.com	001194.cf473b71bf304d9ba30f237f59746a4b.1522	\N	2026-01-10 15:06:36.656577	\N	CA	CA	2026-01-05 15:23:12.844699	2026-01-05 15:23:12.844699	2025-12-17	2026-01-10 15:06:36.656577	t	\N	apple	Danny Muckley
f1f4ea45-5e97-4f49-8e3a-69f307c30f16	Drruff	\N	t	\N	\N	f	2026-01-08 19:05:08.97738	s5dzxwpvnf@privaterelay.appleid.com	001482.4477640601d64f24b9f7847d5d0a2dd3.1904	\N	2026-01-10 15:47:47.770895	\N	TX	TX	2026-01-08 19:05:08.97738	2026-01-08 19:05:08.97738	2025-12-17	2026-01-10 15:47:47.770895	t	\N	apple	Curtis' Friend
a5e05d53-623d-4015-9c57-2e8d99e2f9a4	6Sev	\N	f	\N	\N	f	2026-01-06 07:34:42.690012	42j6fhggkr@privaterelay.appleid.com	001274.04ad2de7211f4cbb8cea1d9e9c5b57f2.0734	\N	2026-01-10 16:45:05.545718	\N	TX	TX	2026-01-06 07:34:42.690012	2026-01-06 07:34:42.690012	2025-12-12	\N	t	\N	apple	\N
b1abaca0-b950-4f59-a54b-4d9bf54b9d0f	JestersDead	\N	t	\N	\N	f	2026-01-06 02:51:13.23261	b9kfk8w9wv@privaterelay.appleid.com	001002.8037a930ef5a4849be10c4edacfe9d6f.0250	\N	2026-01-10 23:11:02.579198	\N	TX	TX	2026-01-06 02:51:13.23261	2026-01-06 02:51:13.23261	2025-12-17	2026-01-10 23:11:02.579198	t	\N	apple	Lance Westlake
3949b108-442c-4bac-b5c9-3dada8fc19b4	Trophy777	\N	t	\N	\N	f	2026-01-10 17:48:15.523221	8c67jn4c6p@privaterelay.appleid.com	001870.e2374b7508164f16b5319245d6b9d22c.1747	\N	2026-01-10 19:39:25.921447	\N	TX	TX	2026-01-10 17:48:15.523221	2026-01-10 17:48:15.523221	2025-12-17	2026-01-10 17:49:26.779712	t	\N	apple	Jason Hewitt
8dbba58f-a902-46c5-acdd-367ebe5822e8	bicwiley	\N	t	\N	\N	f	2026-01-10 20:47:32.263132	bicwiley@gmail.com	000831.a6e3e112e34b4efc9c510125676855ac.2046	Steven Walters 	2026-01-10 21:04:14.854273	\N	OH	OH	2026-01-10 20:47:32.263132	2026-01-10 20:47:32.263132	2025-12-17	2026-01-10 20:47:45.065041	t	\N	apple	Steven Walters
b9318729-2286-465c-b0ae-f2a150d71ad2	josephcortez74	\N	t	\N	\N	f	2026-01-08 00:14:14.8101	josephcortez74@gmail.com	001898.b377599a6d714e6c8ab88957660c1c02.0013	\N	2026-01-10 21:16:27.293349	\N	TX	\N	2026-01-08 00:14:14.8101	2026-01-08 00:14:14.8101	2025-12-17	2026-01-10 21:16:27.293349	t	\N	apple	Curtis' Friend
96894153-2d54-4b2e-9553-b9e866fd9db3	Nitlers3rdReich	\N	t	\N	\N	f	2026-01-06 17:52:22.859309	nshankins@hotmail.com	000710.1761dbd3b52e477ba3629bfb6552a5a6.1711	Nick Hankins	2026-01-10 23:34:39.793436	4693234304	TX	TX	2026-01-06 17:52:22.859309	2026-01-06 17:52:22.859309	2025-12-17	2026-01-10 02:54:27.503847	t	\N	apple	Nick Hankins
d56a5f4d-ca57-438b-b2e6-44ab8f51e142	NateDogg	\N	t	\N	\N	f	2026-01-06 01:39:05.024843	pm7qb6zq56@privaterelay.appleid.com	001940.47ed0c8d042c49f08bf7fc893695a054.0138	\N	2026-01-08 19:48:03.40595	\N	TX	TX	2026-01-06 01:39:05.024843	2026-01-06 01:39:05.024843	2025-12-12	\N	t	\N	apple	Nathan Villa
c1c74d6c-1d2c-4436-a29d-2f6891f3e813	iancarter	\N	f	\N	\N	t	2026-01-08 04:47:37	iancarter13@gmail.com	001282.73db0edd090e43e8be81d4d56f108938.0243	Ian Carter	2026-01-08 05:58:07.210707	(972) 765-1779	TX	TX	2026-01-08 04:47:37	2026-01-08 04:47:37	2025-12-17	2026-01-08 04:48:05	t	\N	apple	Ian Carter - no playing
78228a8f-0563-44b2-bee2-1db1699c6cd9	ShaneRaf	\N	t	\N	\N	f	2026-01-06 02:52:55.783432	h8txqjjt72@privaterelay.appleid.com	000631.081e27750d91494e9aed30e65b6abff9.0252	\N	2026-01-08 19:48:03.40595	\N	TX	TX	2026-01-06 02:52:55.783432	2026-01-06 02:52:55.783432	2025-12-12	\N	t	\N	apple	Shane Raftery
824e9e6e-2ff3-48a1-80d2-6496eb5ff17a	soccerstar20	\N	f	\N	\N	f	2026-01-05 14:27:09.216196	cameroncvrter@gmail.com	001564.ca158412be9d41589dd602ecbade6d52.1426	\N	2026-01-08 19:48:03.40595	\N	TX	TX	2026-01-05 14:27:09.216196	2026-01-05 14:27:09.216196	2025-12-12	\N	t	\N	apple	Cameron Carter
8091de58-9e82-49e2-8712-beaa1486d9ff	TJ_Jenkins	\N	t	\N	\N	f	2026-01-05 15:26:52.903591	j4cyxkqrrx@privaterelay.appleid.com	000351.a1e99acb44694f0aaaa93a82599c4cf7.1526	\N	2026-01-08 19:48:03.40595	8178813748	TX	TX	2026-01-05 15:26:52.903591	2026-01-05 15:26:52.903591	2025-12-12	\N	t	\N	apple	Todd Jenkins
be53f692-990b-4ae6-b061-65753d22fb31	Pokfunatu	\N	t	\N	\N	f	2026-01-07 03:46:22.417745	ftsjf9cxwg@privaterelay.appleid.com	001478.b3d235cda2284db197d46f775869fd17.0345	\N	2026-01-08 19:48:03.40595	\N	TX	\N	2026-01-07 03:46:22.417745	2026-01-07 03:46:22.417745	2025-12-12	\N	t	\N	apple	Tommy Dulworth
4cd229d9-1f32-451c-9244-45ae08835419	HandsomeRob	\N	t	\N	\N	f	2026-01-10 21:02:56.648932	robertandrewkent@gmail.com	001891.27974d45260441d4bb530f87d2cdce61.2102	\N	2026-01-10 21:17:18.407551	\N	TX	TX	2026-01-10 21:02:56.648932	2026-01-10 21:02:56.648932	2025-12-17	2026-01-10 21:03:22.25144	t	\N	apple	Robert Kent
4b6a031e-29f0-4d0c-b13f-9567b0ef2a0c	Titan-up	\N	f	\N	\N	f	2026-01-07 17:50:58.849242	7pmv97dmk9@privaterelay.appleid.com	000440.e24e6a2b345b46bbbbdc74453454e874.1749	\N	2026-01-11 00:21:01.681019	\N	TN	\N	2026-01-07 17:50:58.849242	2026-01-07 17:50:58.849242	2025-12-17	2026-01-11 00:21:01.681019	t	\N	apple	Curtis' friend, not paid yet
c8c1784c-60e4-4b3d-8efa-7c9fe81aa066	AL-V	\N	t	\N	\N	f	2026-01-10 15:11:20.202591	d5jxssk7zh@privaterelay.appleid.com	001069.2d7e7e6987834f128d419f32e1537d3d.1511	\N	2026-01-10 16:26:44.586402	\N	TX	TX	2026-01-10 15:11:20.202591	2026-01-10 15:11:20.202591	2025-12-17	2026-01-10 15:11:42.951364	t	\N	apple	Alan Villa
e5274a58-b24c-45fb-ad7b-711af3d66ea7	TomPolk	\N	t	\N	\N	f	2026-01-10 03:21:07.972547	qzbfk269tz@privaterelay.appleid.com	001363.a31cd885dbe94eaebbc81a4e8785fe94.0320	\N	2026-01-10 16:27:19.283211	\N	VA	VA	2026-01-10 03:21:07.972547	2026-01-10 03:21:07.972547	2025-12-17	2026-01-10 03:21:18.781321	t	\N	apple	Nathan Villa's friend
7bc28e3c-d2a2-4a70-b5a4-6d65eff6e757	Fabiodog	\N	t	\N	\N	f	2026-01-07 17:39:39.73613	curtis_niederhaus@yahoo.com	001124.7ccca051c0374e3e95fdedf326e38588.1739	\N	2026-01-10 16:30:07.169344	\N	TX	TX	2026-01-07 17:39:39.73613	2026-01-07 17:39:39.73613	2025-12-17	2026-01-10 16:30:07.169344	t	\N	apple	Curtis Niederhaus
4486b4ed-d7dd-42a4-a95f-8448fac43b02	ClumsyMaestro	\N	f	\N	\N	f	2026-01-08 21:56:11.070301	w9kyynw9jg@privaterelay.appleid.com	000565.1051f90db8c54166ae79c9bed10b6090.2155	\N	2026-01-10 16:45:14.319787	\N	GA	GA	2026-01-08 21:56:11.070301	2026-01-08 21:56:11.070301	2025-12-12	\N	t	\N	apple	\N
f6cb1bd2-d8db-4b9c-92e5-5dcfbb70bced	rlantxs	\N	t	\N	\N	f	2026-01-09 03:18:38.620716	rarnold2007@windstream.net	001239.b0ad85a2f7a249819ffd18b1ac77b454.0318	\N	2026-01-10 03:09:12.648825	\N	TX	CA	2026-01-09 03:18:38.620716	2026-01-09 03:18:38.620716	2025-12-12	\N	t	\N	apple	Curtis' Friend
f99caf13-0faa-495d-b6d5-1366104cfb6c	Trevon	\N	t	\N	\N	f	2026-01-10 02:15:07.155699	qn8m92cfpg@privaterelay.appleid.com	000086.0f7b03180e0e41728c6e9d5e20e6b465.0214	\N	2026-01-10 03:09:38.665397	\N	TX	TX	2026-01-10 02:15:07.155699	2026-01-10 02:15:07.155699	2025-12-17	2026-01-10 02:15:50.060889	t	\N	apple	Trevon Dulworth
80e4ceb9-1800-4f29-acb5-629187fff6be	sqb2hddtrs	\N	f	\N	\N	f	2026-01-09 07:24:43.323057	sqb2hddtrs@privaterelay.appleid.com	001569.cef4d396f4c54c808f977e8003859630.0724	\N	2026-01-10 16:45:20.420059	\N	CA	SH	2026-01-09 07:24:43.323057	2026-01-09 07:24:43.323057	2025-12-17	2026-01-09 07:24:48.793697	t	\N	apple	\N
eec1354b-3990-419b-9109-e29562821c54	TXB	\N	t	\N	\N	f	2026-01-09 04:54:23.788404	6vv6ssnghx@privaterelay.appleid.com	000918.5a2dfc9f49e2470db332e44fc1897039.0453	\N	2026-01-10 16:54:34.67344	\N	TX	TX	2026-01-09 04:54:23.788404	2026-01-09 04:54:23.788404	2025-12-17	2026-01-10 16:54:34.67344	t	\N	apple	Justin Hewitt
c05554c7-c311-43c6-a070-40cb889e840a	JenksTTU	\N	t	\N	\N	f	2026-01-10 03:44:31.328523	jakejenkins1010@yahoo.com	000293.16df8a160f5549cfa4d9f772002980f2.0344	\N	2026-01-10 04:14:41.467546	\N	TX	TX	2026-01-10 03:44:31.328523	2026-01-10 03:44:31.328523	2025-12-17	2026-01-10 03:44:44.945891	t	\N	apple	Jacob Jenkins
672ac17e-17d2-4773-a623-07026cd98aca	Wingies	\N	t	\N	\N	f	2026-01-07 01:19:50.677936	grtgjq75d9@privaterelay.appleid.com	001859.6da299e9ae264603be1ac50ea5af94ed.0119	\N	2026-01-10 14:17:10.414517	\N	TX	TX	2026-01-07 01:19:50.677936	2026-01-07 01:19:50.677936	2025-12-17	2026-01-10 14:17:10.414517	t	\N	apple	Jake Daggett
0477bff2-c2e4-45e2-a00b-225df2154d96	JPearson	\N	t	\N	\N	f	2026-01-07 14:22:58.79548	john.pearson@atmosenergy.com	000896.1d5f6175fb274e27bcc7658b68dce97d.1422	\N	2026-01-10 14:37:40.060744	469-261-7426	TX	TX	2026-01-07 14:22:58.79548	2026-01-07 14:22:58.79548	2025-12-17	2026-01-10 14:37:40.060744	t	\N	apple	John Pearson
9fb7076d-153c-4a44-806e-2b4aef1f57f9	Garrett75	\N	t	\N	\N	f	2026-01-09 19:52:05.378297	4mkk7nrkvv@privaterelay.appleid.com	001319.f24faf111df14facbeba3c42ffad4a11.1951	\N	2026-01-10 19:39:03.708837	\N	TX	TX	2026-01-09 19:52:05.378297	2026-01-09 19:52:05.378297	2025-12-17	2026-01-09 19:59:24.550777	t	\N	apple	Justin Hewitt's friend
6c600817-b75f-49d3-8eb3-92b9b4849018	bwilliams_09	\N	t	\N	\N	f	2026-01-10 18:45:44.19509	bwilliams_09@hotmail.com	001213.c49c233ece2d4cf1b51e873f7962b835.1845	\N	2026-01-10 21:07:32.463321	\N	TX	TX	2026-01-10 18:45:44.19509	2026-01-10 18:45:44.19509	2025-12-17	2026-01-10 18:45:48.902457	t	\N	apple	Brett Williams - Ian's friend
\.


--
-- Name: payout_structure_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.payout_structure_id_seq', 7, true);


--
-- Name: payouts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.payouts_id_seq', 3, true);


--
-- Name: pick_multipliers_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.pick_multipliers_id_seq', 1, false);


--
-- Name: player_swaps_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.player_swaps_id_seq', 1, true);


--
-- Name: position_requirements_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.position_requirements_id_seq', 21, true);


--
-- Name: rules_content_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.rules_content_id_seq', 13, true);


--
-- Name: scoring_rules_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.scoring_rules_id_seq', 179, true);


--
-- Name: signup_attempts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.signup_attempts_id_seq', 82, true);


--
-- Name: game_settings game_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_settings
    ADD CONSTRAINT game_settings_pkey PRIMARY KEY (id);


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
-- Name: picks picks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.picks
    ADD CONSTRAINT picks_pkey PRIMARY KEY (id);


--
-- Name: picks picks_user_id_player_id_week_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.picks
    ADD CONSTRAINT picks_user_id_player_id_week_key UNIQUE (user_id, player_id, week_number);


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
-- Name: scores scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scores
    ADD CONSTRAINT scores_pkey PRIMARY KEY (id);


--
-- Name: scoring_rules scoring_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scoring_rules
    ADD CONSTRAINT scoring_rules_pkey PRIMARY KEY (id);


--
-- Name: signup_attempts signup_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signup_attempts
    ADD CONSTRAINT signup_attempts_pkey PRIMARY KEY (id);


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
-- Name: unique_espn_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX unique_espn_id ON public.players USING btree (espn_id);


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
-- Name: pick_multipliers pick_multipliers_pick_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pick_multipliers
    ADD CONSTRAINT pick_multipliers_pick_id_fkey FOREIGN KEY (pick_id) REFERENCES public.picks(id) ON DELETE CASCADE;


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
-- PostgreSQL database dump complete
--

\unrestrict 59lWZgkpeBfDkQH8KzABTB9SZNvHFIqhidePZH7K0SVVymr82P1Q0WZ3PD1hWBg


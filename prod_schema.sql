--
-- PostgreSQL database dump
--

\restrict Sz66SMJltMoWm90EFWodOYxCrjXhKCmRNnm9EImOi6vTfJHKnkKyFsMPwcAEMeE

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
-- Name: VIEW v_game_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.v_game_status IS 'Shows current game state and week mappings';


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

\unrestrict Sz66SMJltMoWm90EFWodOYxCrjXhKCmRNnm9EImOi6vTfJHKnkKyFsMPwcAEMeE


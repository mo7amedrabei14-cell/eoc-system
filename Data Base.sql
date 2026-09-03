--
-- PostgreSQL database dump
--

\restrict YQHZOx72tDeF9xahUlFa1bP4vgakWrBd2DGqy6pU3irELFQbNX0yhTq9Zd1jkh5

-- Dumped from database version 18.4
-- Dumped by pg_dump version 18.4

-- Started on 2026-08-31 16:01:49

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
-- TOC entry 272 (class 1255 OID 16445)
-- Name: generate_mission_code(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.generate_mission_code() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.mission_code :=
        'M-' ||
        TO_CHAR(CURRENT_DATE, 'YYYY') ||
        '-' ||
        LPAD(NEW.mission_id::TEXT, 6, '0');

    RETURN NEW;
END;
$$;


ALTER FUNCTION public.generate_mission_code() OWNER TO postgres;

--
-- TOC entry 275 (class 1255 OID 16716)
-- Name: prevent_duplicate_daily_volunteer(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.prevent_duplicate_daily_volunteer() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    open_mission BOOLEAN;
BEGIN
    SELECT is_open_mission
    INTO open_mission
    FROM missions
    WHERE mission_id = NEW.mission_id
    FOR UPDATE;

    IF open_mission = FALSE THEN

        IF EXISTS (
            SELECT 1
            FROM mission_participants
            WHERE mission_id = NEW.mission_id
              AND volunteer_id = NEW.volunteer_id
        ) THEN

            RAISE EXCEPTION
                'Volunteer % is already assigned to daily mission %',
                NEW.volunteer_id,
                NEW.mission_id
                USING ERRCODE = '23505';

        END IF;

    END IF;

    RETURN NEW;
END;
$$;


ALTER FUNCTION public.prevent_duplicate_daily_volunteer() OWNER TO postgres;

--
-- TOC entry 274 (class 1255 OID 16709)
-- Name: validate_mission_open_status(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.validate_mission_open_status() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    duplicate_count INTEGER;
BEGIN

    -- Only validate when changing an open mission
    -- into a normal mission
    IF OLD.is_open_mission = TRUE
       AND NEW.is_open_mission = FALSE THEN

        SELECT COUNT(*)
        INTO duplicate_count
        FROM (
            SELECT volunteer_id
            FROM mission_participants
            WHERE mission_id = NEW.mission_id
            GROUP BY volunteer_id
            HAVING COUNT(*) > 1
        ) duplicates;

        IF duplicate_count > 0 THEN
            RAISE EXCEPTION
                'Cannot close mission: duplicate volunteers exist';
        END IF;

    END IF;

    RETURN NEW;
END;
$$;


ALTER FUNCTION public.validate_mission_open_status() OWNER TO postgres;

--
-- TOC entry 273 (class 1255 OID 16707)
-- Name: validate_mission_participant(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.validate_mission_participant() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    mission_is_open BOOLEAN;
    participant_exists BOOLEAN;
BEGIN

    -- Get the mission type
    SELECT is_open_mission
    INTO mission_is_open
    FROM missions
    WHERE mission_id = NEW.mission_id
    FOR UPDATE;

    -- Mission must exist
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Mission does not exist';
    END IF;

    -- Open missions allow duplicate volunteers
    IF mission_is_open = TRUE THEN
        RETURN NEW;
    END IF;

    -- Normal missions do not allow duplicate volunteers
    SELECT EXISTS (
        SELECT 1
        FROM mission_participants
        WHERE mission_id = NEW.mission_id
          AND volunteer_id = NEW.volunteer_id
          AND participant_id <> COALESCE(NEW.participant_id, -1)
    )
    INTO participant_exists;

    IF participant_exists THEN
        RAISE EXCEPTION
            'Volunteer % is already assigned to mission %',
            NEW.volunteer_id,
            NEW.mission_id;
    END IF;

    RETURN NEW;
END;
$$;


ALTER FUNCTION public.validate_mission_participant() OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- TOC entry 271 (class 1259 OID 17193)
-- Name: ai_news; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ai_news (
    id integer NOT NULL,
    incident_date date,
    incident_month character varying(50),
    incident_description text,
    news_type character varying(255),
    news_publisher character varying(255),
    street_name character varying(255),
    area_name character varying(255),
    governorate character varying(255),
    hospital_name character varying(255),
    injured_count character varying(50),
    deaths_count character varying(50),
    news_updates text,
    news_link text,
    data_entry_name character varying(255),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.ai_news OWNER TO postgres;

--
-- TOC entry 270 (class 1259 OID 17192)
-- Name: ai_news_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.ai_news_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.ai_news_id_seq OWNER TO postgres;

--
-- TOC entry 5406 (class 0 OID 0)
-- Dependencies: 270
-- Name: ai_news_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.ai_news_id_seq OWNED BY public.ai_news.id;


--
-- TOC entry 246 (class 1259 OID 16736)
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.audit_logs (
    audit_id bigint NOT NULL,
    user_id integer,
    action character varying(100) NOT NULL,
    entity_type character varying(100),
    entity_id bigint,
    details jsonb,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    mission_id bigint
);


ALTER TABLE public.audit_logs OWNER TO postgres;

--
-- TOC entry 245 (class 1259 OID 16735)
-- Name: audit_logs_audit_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.audit_logs_audit_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.audit_logs_audit_id_seq OWNER TO postgres;

--
-- TOC entry 5407 (class 0 OID 0)
-- Dependencies: 245
-- Name: audit_logs_audit_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.audit_logs_audit_id_seq OWNED BY public.audit_logs.audit_id;


--
-- TOC entry 240 (class 1259 OID 16623)
-- Name: branch_governorates; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.branch_governorates (
    branch_governorate_id bigint NOT NULL,
    branch_id integer NOT NULL,
    governorate_id integer NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.branch_governorates OWNER TO postgres;

--
-- TOC entry 239 (class 1259 OID 16622)
-- Name: branch_governorates_branch_governorate_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.branch_governorates ALTER COLUMN branch_governorate_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.branch_governorates_branch_governorate_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 249 (class 1259 OID 16958)
-- Name: branch_inventory; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.branch_inventory (
    branch_id integer NOT NULL,
    cars integer DEFAULT 0,
    tents integer DEFAULT 0,
    mattresses integer DEFAULT 0,
    fire_extinguishers integer DEFAULT 0,
    plastic_mats integer DEFAULT 0,
    pillows integer DEFAULT 0,
    bed_sheets integer DEFAULT 0,
    blood_banks integer DEFAULT 0,
    hospitals integer DEFAULT 0,
    ambulances integer DEFAULT 0,
    water_tanks integer DEFAULT 0,
    plastic_buckets integer DEFAULT 0,
    plastic_jerrycans integer DEFAULT 0,
    blankets integer DEFAULT 0,
    motorola_radios integer DEFAULT 0,
    huawei_radios integer DEFAULT 0,
    first_aid_kits integer DEFAULT 0,
    stretchers integer DEFAULT 0,
    helmets integer DEFAULT 0,
    ice_boxes integer DEFAULT 0,
    vests integer DEFAULT 0,
    caps integer DEFAULT 0,
    disinfection_machines integer DEFAULT 0,
    manual_sprayers integer DEFAULT 0,
    plastic_goggles integer DEFAULT 0,
    plastic_boots integer DEFAULT 0,
    psych_support_teams integer DEFAULT 0,
    psych_support_vols integer DEFAULT 0,
    health_awareness_teams integer DEFAULT 0,
    health_awareness_vols integer DEFAULT 0,
    first_aid_trainers_hq integer DEFAULT 0,
    first_aid_trainers_branch integer DEFAULT 0,
    first_aid_teams integer DEFAULT 0,
    first_aid_vols integer DEFAULT 0,
    wash_vols integer DEFAULT 0,
    emergency_teams integer DEFAULT 0,
    emergency_vols integer DEFAULT 0,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.branch_inventory OWNER TO postgres;

--
-- TOC entry 222 (class 1259 OID 16402)
-- Name: branches; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.branches (
    branch_id integer NOT NULL,
    branch_name character varying(100) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    has_geographic_scope boolean DEFAULT true NOT NULL,
    address character varying(255),
    latitude numeric(10,6),
    longitude numeric(10,6)
);


ALTER TABLE public.branches OWNER TO postgres;

--
-- TOC entry 221 (class 1259 OID 16401)
-- Name: branches_branch_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.branches ALTER COLUMN branch_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.branches_branch_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 269 (class 1259 OID 17182)
-- Name: egypt_earthquakes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.egypt_earthquakes (
    eq_id integer NOT NULL,
    date character varying(50) NOT NULL,
    "time" character varying(50),
    magnitude double precision NOT NULL,
    depth_km character varying(50),
    region character varying(255),
    longitude double precision,
    latitude double precision,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.egypt_earthquakes OWNER TO postgres;

--
-- TOC entry 268 (class 1259 OID 17181)
-- Name: egypt_earthquakes_eq_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.egypt_earthquakes_eq_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.egypt_earthquakes_eq_id_seq OWNER TO postgres;

--
-- TOC entry 5408 (class 0 OID 0)
-- Dependencies: 268
-- Name: egypt_earthquakes_eq_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.egypt_earthquakes_eq_id_seq OWNED BY public.egypt_earthquakes.eq_id;


--
-- TOC entry 265 (class 1259 OID 17153)
-- Name: global_disasters; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.global_disasters (
    disaster_id integer NOT NULL,
    incident_date date NOT NULL,
    incident_month character varying(50),
    news_title text,
    country character varying(100),
    disaster_type character varying(100),
    affected_areas text,
    at_risk_areas text,
    source_name character varying(255),
    injured_count integer DEFAULT 0,
    deaths_count integer DEFAULT 0,
    missing_count integer DEFAULT 0,
    national_societies_interventions text,
    news_link text NOT NULL,
    news_updates text,
    data_entry_name character varying(150),
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.global_disasters OWNER TO postgres;

--
-- TOC entry 264 (class 1259 OID 17152)
-- Name: global_disasters_disaster_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.global_disasters_disaster_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.global_disasters_disaster_id_seq OWNER TO postgres;

--
-- TOC entry 5409 (class 0 OID 0)
-- Dependencies: 264
-- Name: global_disasters_disaster_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.global_disasters_disaster_id_seq OWNED BY public.global_disasters.disaster_id;


--
-- TOC entry 267 (class 1259 OID 17169)
-- Name: global_earthquakes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.global_earthquakes (
    eq_id integer NOT NULL,
    date character varying(50) NOT NULL,
    month character varying(50),
    "time" character varying(50),
    country character varying(150),
    magnitude double precision NOT NULL,
    depth_km character varying(50),
    region character varying(255),
    status character varying(50),
    longitude double precision,
    latitude double precision,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.global_earthquakes OWNER TO postgres;

--
-- TOC entry 266 (class 1259 OID 17168)
-- Name: global_earthquakes_eq_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.global_earthquakes_eq_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.global_earthquakes_eq_id_seq OWNER TO postgres;

--
-- TOC entry 5410 (class 0 OID 0)
-- Dependencies: 266
-- Name: global_earthquakes_eq_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.global_earthquakes_eq_id_seq OWNED BY public.global_earthquakes.eq_id;


--
-- TOC entry 238 (class 1259 OID 16609)
-- Name: governorates; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.governorates (
    governorate_id integer NOT NULL,
    governorate_name character varying(100) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.governorates OWNER TO postgres;

--
-- TOC entry 237 (class 1259 OID 16608)
-- Name: governorates_governorate_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.governorates ALTER COLUMN governorate_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.governorates_governorate_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 263 (class 1259 OID 17128)
-- Name: local_news; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.local_news (
    news_id integer NOT NULL,
    branch_id integer,
    incident_date date,
    incident_month character varying(50),
    incident_description text,
    news_type character varying(255),
    news_publisher character varying(255),
    street_name character varying(255),
    area_name character varying(255),
    governorate character varying(255),
    is_reported boolean DEFAULT false,
    report_time time without time zone,
    is_responded boolean DEFAULT false,
    branch_response_text text,
    response_time time without time zone,
    response_time_points integer DEFAULT 0,
    response_duration character varying(100),
    is_field_response boolean DEFAULT false,
    movement_time time without time zone,
    report_to_movement_duration character varying(100),
    movement_points integer DEFAULT 0,
    field_arrival_time time without time zone,
    distance_km numeric,
    field_response_points integer DEFAULT 0,
    report_to_arrival_duration character varying(100),
    intervention_type character varying(255),
    intervening_branch character varying(255),
    mission_form_name character varying(255),
    participants_count integer DEFAULT 0,
    hospital_name character varying(255),
    injured_count integer DEFAULT 0,
    deaths_count integer DEFAULT 0,
    news_updates text,
    news_link text,
    data_entry_name character varying(255),
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.local_news OWNER TO postgres;

--
-- TOC entry 262 (class 1259 OID 17127)
-- Name: local_news_news_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.local_news_news_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.local_news_news_id_seq OWNER TO postgres;

--
-- TOC entry 5411 (class 0 OID 0)
-- Dependencies: 262
-- Name: local_news_news_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.local_news_news_id_seq OWNED BY public.local_news.news_id;


--
-- TOC entry 259 (class 1259 OID 17088)
-- Name: mission_beneficiaries; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.mission_beneficiaries (
    beneficiary_id integer NOT NULL,
    mission_id integer,
    category_name character varying(100),
    direct_count integer DEFAULT 0,
    indirect_count integer DEFAULT 0
);


ALTER TABLE public.mission_beneficiaries OWNER TO postgres;

--
-- TOC entry 258 (class 1259 OID 17087)
-- Name: mission_beneficiaries_beneficiary_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.mission_beneficiaries_beneficiary_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.mission_beneficiaries_beneficiary_id_seq OWNER TO postgres;

--
-- TOC entry 5412 (class 0 OID 0)
-- Dependencies: 258
-- Name: mission_beneficiaries_beneficiary_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.mission_beneficiaries_beneficiary_id_seq OWNED BY public.mission_beneficiaries.beneficiary_id;


--
-- TOC entry 261 (class 1259 OID 17103)
-- Name: mission_eoc_staff; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.mission_eoc_staff (
    staff_id integer NOT NULL,
    mission_id integer,
    role_name character varying(100),
    staff_name character varying(150)
);


ALTER TABLE public.mission_eoc_staff OWNER TO postgres;

--
-- TOC entry 260 (class 1259 OID 17102)
-- Name: mission_eoc_staff_staff_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.mission_eoc_staff_staff_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.mission_eoc_staff_staff_id_seq OWNER TO postgres;

--
-- TOC entry 5413 (class 0 OID 0)
-- Dependencies: 260
-- Name: mission_eoc_staff_staff_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.mission_eoc_staff_staff_id_seq OWNED BY public.mission_eoc_staff.staff_id;


--
-- TOC entry 253 (class 1259 OID 17044)
-- Name: mission_itineraries; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.mission_itineraries (
    itinerary_id integer NOT NULL,
    mission_id integer,
    route_to character varying(255),
    departure_time time without time zone,
    arrival_time time without time zone,
    group_title character varying(150) DEFAULT 'خط السير الأساسي'::character varying
);


ALTER TABLE public.mission_itineraries OWNER TO postgres;

--
-- TOC entry 252 (class 1259 OID 17043)
-- Name: mission_itineraries_itinerary_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.mission_itineraries_itinerary_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.mission_itineraries_itinerary_id_seq OWNER TO postgres;

--
-- TOC entry 5414 (class 0 OID 0)
-- Dependencies: 252
-- Name: mission_itineraries_itinerary_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.mission_itineraries_itinerary_id_seq OWNED BY public.mission_itineraries.itinerary_id;


--
-- TOC entry 248 (class 1259 OID 16809)
-- Name: mission_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.mission_logs (
    log_id bigint NOT NULL,
    mission_id bigint NOT NULL,
    branch_id integer,
    communication_method character varying(150),
    log_date date NOT NULL,
    log_time time without time zone NOT NULL,
    action_status character varying(100),
    notes text,
    created_by integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.mission_logs OWNER TO postgres;

--
-- TOC entry 247 (class 1259 OID 16808)
-- Name: mission_logs_log_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.mission_logs ALTER COLUMN log_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.mission_logs_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 226 (class 1259 OID 16490)
-- Name: mission_participant_sessions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.mission_participant_sessions (
    session_id bigint NOT NULL,
    participant_id bigint NOT NULL,
    session_date date NOT NULL,
    check_in_time time without time zone,
    check_out_time time without time zone,
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.mission_participant_sessions OWNER TO postgres;

--
-- TOC entry 225 (class 1259 OID 16489)
-- Name: mission_participant_sessions_session_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.mission_participant_sessions ALTER COLUMN session_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.mission_participant_sessions_session_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 257 (class 1259 OID 17070)
-- Name: mission_participants; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.mission_participants (
    participant_id integer NOT NULL,
    mission_id integer,
    participant_type character varying(50),
    full_name character varying(150),
    participation_role character varying(100),
    branch_id integer,
    assigned_itinerary character varying(150) DEFAULT 'خط السير الأساسي'::character varying,
    team_name character varying(100) DEFAULT ''::character varying,
    team_code character varying(50) DEFAULT ''::character varying,
    return_status character varying(50) DEFAULT 'مازال بالمهمة'::character varying,
    phase_name character varying(100) DEFAULT 'اليوم الأول'::character varying,
    stay_type character varying(50) DEFAULT 'ذهاب وعودة'::character varying
);


ALTER TABLE public.mission_participants OWNER TO postgres;

--
-- TOC entry 256 (class 1259 OID 17069)
-- Name: mission_participants_participant_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.mission_participants_participant_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.mission_participants_participant_id_seq OWNER TO postgres;

--
-- TOC entry 5415 (class 0 OID 0)
-- Dependencies: 256
-- Name: mission_participants_participant_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.mission_participants_participant_id_seq OWNED BY public.mission_participants.participant_id;


--
-- TOC entry 244 (class 1259 OID 16679)
-- Name: mission_status_history; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.mission_status_history (
    history_id bigint NOT NULL,
    mission_id bigint NOT NULL,
    previous_status character varying(50) NOT NULL,
    new_status character varying(50) NOT NULL,
    action character varying(20) NOT NULL,
    action_by integer NOT NULL,
    action_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    reason text,
    CONSTRAINT mission_status_history_action_check CHECK (((action)::text = ANY ((ARRAY['submit'::character varying, 'review'::character varying, 'approve'::character varying, 'complete'::character varying, 'final_review'::character varying, 'archive'::character varying, 'return'::character varying, 'cancel'::character varying])::text[]))),
    CONSTRAINT mission_status_history_reason_check CHECK (((((action)::text = ANY ((ARRAY['return'::character varying, 'cancel'::character varying])::text[])) AND (reason IS NOT NULL) AND (btrim(reason) <> ''::text)) OR ((action)::text <> ALL ((ARRAY['return'::character varying, 'cancel'::character varying])::text[]))))
);


ALTER TABLE public.mission_status_history OWNER TO postgres;

--
-- TOC entry 243 (class 1259 OID 16678)
-- Name: mission_status_history_history_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.mission_status_history ALTER COLUMN history_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.mission_status_history_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 255 (class 1259 OID 17057)
-- Name: mission_vehicles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.mission_vehicles (
    vehicle_id integer NOT NULL,
    mission_id integer,
    driver_name character varying(150),
    vehicle_number character varying(50)
);


ALTER TABLE public.mission_vehicles OWNER TO postgres;

--
-- TOC entry 254 (class 1259 OID 17056)
-- Name: mission_vehicles_vehicle_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.mission_vehicles_vehicle_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.mission_vehicles_vehicle_id_seq OWNER TO postgres;

--
-- TOC entry 5416 (class 0 OID 0)
-- Dependencies: 254
-- Name: mission_vehicles_vehicle_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.mission_vehicles_vehicle_id_seq OWNED BY public.mission_vehicles.vehicle_id;


--
-- TOC entry 251 (class 1259 OID 17021)
-- Name: missions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.missions (
    mission_id integer NOT NULL,
    mission_code character varying(50) NOT NULL,
    mission_name character varying(255) NOT NULL,
    branch_id integer,
    mission_type character varying(100),
    mission_location character varying(255),
    responsible_person character varying(100),
    data_source character varying(100),
    status character varying(50) DEFAULT 'Draft'::character varying,
    exit_date date,
    departure_date date,
    arrival_date date,
    return_date date,
    completion_date date,
    start_time time without time zone,
    departure_time time without time zone,
    arrival_time time without time zone,
    completion_time time without time zone,
    injured_count integer DEFAULT 0,
    indirect_beneficiaries_total integer DEFAULT 0,
    notes text,
    internal_notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    mission_classification character varying(50) DEFAULT 'عادية'::character varying
);


ALTER TABLE public.missions OWNER TO postgres;

--
-- TOC entry 250 (class 1259 OID 17020)
-- Name: missions_mission_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.missions_mission_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.missions_mission_id_seq OWNER TO postgres;

--
-- TOC entry 5417 (class 0 OID 0)
-- Dependencies: 250
-- Name: missions_mission_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.missions_mission_id_seq OWNED BY public.missions.mission_id;


--
-- TOC entry 232 (class 1259 OID 16548)
-- Name: permissions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.permissions (
    permission_id integer NOT NULL,
    permission_code character varying(100) NOT NULL,
    description text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.permissions OWNER TO postgres;

--
-- TOC entry 231 (class 1259 OID 16547)
-- Name: permissions_permission_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.permissions ALTER COLUMN permission_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.permissions_permission_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 236 (class 1259 OID 16585)
-- Name: role_inheritance; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.role_inheritance (
    role_inheritance_id bigint NOT NULL,
    parent_role_id integer NOT NULL,
    child_role_id integer NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT role_inheritance_check CHECK ((parent_role_id <> child_role_id))
);


ALTER TABLE public.role_inheritance OWNER TO postgres;

--
-- TOC entry 235 (class 1259 OID 16584)
-- Name: role_inheritance_role_inheritance_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.role_inheritance ALTER COLUMN role_inheritance_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.role_inheritance_role_inheritance_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 234 (class 1259 OID 16562)
-- Name: role_permissions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.role_permissions (
    role_permission_id bigint NOT NULL,
    role_id integer NOT NULL,
    permission_id integer NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.role_permissions OWNER TO postgres;

--
-- TOC entry 233 (class 1259 OID 16561)
-- Name: role_permissions_role_permission_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.role_permissions ALTER COLUMN role_permission_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.role_permissions_role_permission_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 228 (class 1259 OID 16511)
-- Name: roles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.roles (
    role_id integer NOT NULL,
    role_name character varying(50) NOT NULL,
    description text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.roles OWNER TO postgres;

--
-- TOC entry 227 (class 1259 OID 16510)
-- Name: roles_role_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.roles ALTER COLUMN role_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.roles_role_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 242 (class 1259 OID 16647)
-- Name: user_branches; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_branches (
    user_branch_id bigint NOT NULL,
    user_id bigint NOT NULL,
    branch_id integer NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.user_branches OWNER TO postgres;

--
-- TOC entry 241 (class 1259 OID 16646)
-- Name: user_branches_user_branch_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.user_branches ALTER COLUMN user_branch_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.user_branches_user_branch_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 230 (class 1259 OID 16525)
-- Name: user_roles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_roles (
    user_role_id bigint NOT NULL,
    user_id bigint NOT NULL,
    role_id integer NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.user_roles OWNER TO postgres;

--
-- TOC entry 229 (class 1259 OID 16524)
-- Name: user_roles_user_role_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.user_roles ALTER COLUMN user_role_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.user_roles_user_role_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 220 (class 1259 OID 16386)
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    user_id integer NOT NULL,
    full_name character varying(100) NOT NULL,
    username character varying(50) NOT NULL,
    role character varying(20) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    password_hash text
);


ALTER TABLE public.users OWNER TO postgres;

--
-- TOC entry 219 (class 1259 OID 16385)
-- Name: users_user_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.users ALTER COLUMN user_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.users_user_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 224 (class 1259 OID 16448)
-- Name: volunteers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.volunteers (
    volunteer_id bigint NOT NULL,
    full_name character varying(150) NOT NULL,
    phone character varying(30),
    branch_id integer,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    membership_number character varying(50),
    status_mode character varying(10) DEFAULT 'auto'::character varying NOT NULL,
    last_check_in_at timestamp without time zone,
    CONSTRAINT volunteers_status_mode_check CHECK (((status_mode)::text = ANY ((ARRAY['auto'::character varying, 'manual'::character varying])::text[])))
);


ALTER TABLE public.volunteers OWNER TO postgres;

--
-- TOC entry 223 (class 1259 OID 16447)
-- Name: volunteers_volunteer_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.volunteers ALTER COLUMN volunteer_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.volunteers_volunteer_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 5089 (class 2604 OID 17196)
-- Name: ai_news id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_news ALTER COLUMN id SET DEFAULT nextval('public.ai_news_id_seq'::regclass);


--
-- TOC entry 5008 (class 2604 OID 16739)
-- Name: audit_logs audit_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.audit_logs ALTER COLUMN audit_id SET DEFAULT nextval('public.audit_logs_audit_id_seq'::regclass);


--
-- TOC entry 5087 (class 2604 OID 17185)
-- Name: egypt_earthquakes eq_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.egypt_earthquakes ALTER COLUMN eq_id SET DEFAULT nextval('public.egypt_earthquakes_eq_id_seq'::regclass);


--
-- TOC entry 5080 (class 2604 OID 17156)
-- Name: global_disasters disaster_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.global_disasters ALTER COLUMN disaster_id SET DEFAULT nextval('public.global_disasters_disaster_id_seq'::regclass);


--
-- TOC entry 5085 (class 2604 OID 17172)
-- Name: global_earthquakes eq_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.global_earthquakes ALTER COLUMN eq_id SET DEFAULT nextval('public.global_earthquakes_eq_id_seq'::regclass);


--
-- TOC entry 5069 (class 2604 OID 17131)
-- Name: local_news news_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.local_news ALTER COLUMN news_id SET DEFAULT nextval('public.local_news_news_id_seq'::regclass);


--
-- TOC entry 5065 (class 2604 OID 17091)
-- Name: mission_beneficiaries beneficiary_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mission_beneficiaries ALTER COLUMN beneficiary_id SET DEFAULT nextval('public.mission_beneficiaries_beneficiary_id_seq'::regclass);


--
-- TOC entry 5068 (class 2604 OID 17106)
-- Name: mission_eoc_staff staff_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mission_eoc_staff ALTER COLUMN staff_id SET DEFAULT nextval('public.mission_eoc_staff_staff_id_seq'::regclass);


--
-- TOC entry 5055 (class 2604 OID 17047)
-- Name: mission_itineraries itinerary_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mission_itineraries ALTER COLUMN itinerary_id SET DEFAULT nextval('public.mission_itineraries_itinerary_id_seq'::regclass);


--
-- TOC entry 5058 (class 2604 OID 17073)
-- Name: mission_participants participant_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mission_participants ALTER COLUMN participant_id SET DEFAULT nextval('public.mission_participants_participant_id_seq'::regclass);


--
-- TOC entry 5057 (class 2604 OID 17060)
-- Name: mission_vehicles vehicle_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mission_vehicles ALTER COLUMN vehicle_id SET DEFAULT nextval('public.mission_vehicles_vehicle_id_seq'::regclass);


--
-- TOC entry 5049 (class 2604 OID 17024)
-- Name: missions mission_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.missions ALTER COLUMN mission_id SET DEFAULT nextval('public.missions_mission_id_seq'::regclass);


--
-- TOC entry 5400 (class 0 OID 17193)
-- Dependencies: 271
-- Data for Name: ai_news; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.ai_news (id, incident_date, incident_month, incident_description, news_type, news_publisher, street_name, area_name, governorate, hospital_name, injured_count, deaths_count, news_updates, news_link, data_entry_name, created_at) FROM stdin;
\.


--
-- TOC entry 5375 (class 0 OID 16736)
-- Dependencies: 246
-- Data for Name: audit_logs; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.audit_logs (audit_id, user_id, action, entity_type, entity_id, details, created_at, mission_id) FROM stdin;
1	14	تحديث/مراجعة	mission	11	{"action_text": "قام بتحديث الاستمارة أو تغيير حالتها إلى: Completed"}	2026-08-26 07:09:25.449411	11
2	14	تحديث/مراجعة	mission	11	{"action_text": "قام بتحديث الاستمارة أو تغيير حالتها إلى: Completed"}	2026-08-26 07:09:38.088472	11
\.


--
-- TOC entry 5369 (class 0 OID 16623)
-- Dependencies: 240
-- Data for Name: branch_governorates; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.branch_governorates (branch_governorate_id, branch_id, governorate_id, created_at) FROM stdin;
\.


--
-- TOC entry 5378 (class 0 OID 16958)
-- Dependencies: 249
-- Data for Name: branch_inventory; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.branch_inventory (branch_id, cars, tents, mattresses, fire_extinguishers, plastic_mats, pillows, bed_sheets, blood_banks, hospitals, ambulances, water_tanks, plastic_buckets, plastic_jerrycans, blankets, motorola_radios, huawei_radios, first_aid_kits, stretchers, helmets, ice_boxes, vests, caps, disinfection_machines, manual_sprayers, plastic_goggles, plastic_boots, psych_support_teams, psych_support_vols, health_awareness_teams, health_awareness_vols, first_aid_trainers_hq, first_aid_trainers_branch, first_aid_teams, first_aid_vols, wash_vols, emergency_teams, emergency_vols, updated_at) FROM stdin;
6	2	70	0	10	0	0	0	0	0	0	3	0	0	257	2	1	0	2	0	3	70	70	2	0	10	10	1	5	2	10	0	5	4	20	11	8	38	2026-08-26 01:21:25.698134
7	2	78	14	4	0	1	50	1	0	0	2	0	0	1183	2	0	1	1	15	3	20	10	0	2	0	0	1	2	2	0	0	0	0	0	4	2	10	2026-08-26 01:21:25.698134
8	9	0	100	0	0	100	0	1	2	0	0	0	100	500	9	0	9	6	4	3	100	0	0	0	0	0	7	35	9	0	0	0	347	1735	4	3	16	2026-08-26 01:21:25.698134
9	1	100	3873	4	0	357	15	0	0	0	1	100	167	500	3	0	4	2	1	2	20	0	2	2	0	0	1	5	0	0	0	0	0	0	0	7	31	2026-08-26 01:21:25.698134
10	2	14	99	3	49	50	0	1	0	0	0	3	15	85	2	0	3	3	0	1	10	0	1	0	0	0	1	5	10	50	3	0	1	0	2	7	35	2026-08-26 01:21:25.698134
11	1	30	100	5	50	50	0	1	0	0	3	0	0	150	6	0	0	4	0	0	50	0	1	0	0	0	1	5	0	0	0	5	16	80	0	10	50	2026-08-26 01:21:25.698134
12	0	20	20	1	40	0	0	1	1	0	0	0	0	300	0	0	2	1	0	3	14	0	2	0	1	2	0	0	0	0	0	0	0	0	0	0	0	2026-08-26 01:21:25.698134
13	1	34	100	0	65	90	0	0	0	0	0	0	0	91	4	0	2	2	0	0	7	0	4	0	10	0	1	5	0	0	3	0	3	0	0	1	3	2026-08-26 01:21:25.698134
14	1	65	150	3	0	50	0	1	1	1	0	0	0	125	4	0	5	4	0	3	50	50	2	3	5	2	122	0	61	60	0	0	126	0	31	2	10	2026-08-26 01:21:25.698134
15	0	25	60	0	0	0	0	0	0	0	0	0	0	0	2	0	0	1	0	0	50	0	0	0	0	0	3	15	1	1	0	0	10	50	0	2	8	2026-08-26 01:21:25.698134
16	1	50	0	0	0	0	0	0	0	0	0	0	0	0	4	0	0	1	5	0	0	0	0	0	0	4	1	5	0	1	0	0	1	5	1	1	6	2026-08-26 01:21:25.698134
17	2	7	8	52	0	10	5	1	1	1	0	0	0	20	6	0	3	3	3	3	40	30	2	2	1	1	5	27	1	5	0	13	9	45	5	3	14	2026-08-26 01:21:25.698134
18	0	5	40	2	0	30	0	0	0	0	0	0	0	40	0	0	0	0	0	0	40	15	0	0	0	1	1	3	1	4	0	0	1	5	0	1	3	2026-08-26 01:21:25.698134
20	3	30	60	0	10	20	50	1	0	0	0	0	10	245	0	0	1	2	0	3	0	0	0	0	0	0	1	1	0	0	0	0	2	7	0	1	5	2026-08-26 01:21:25.698134
19	0	0	0	0	0	0	0	0	0	0	0	0	0	0	0	0	0	0	0	0	0	0	0	0	0	0	0	0	0	0	0	0	0	0	0	0	0	2026-08-26 01:21:25.698134
21	2	122	146	0	115	68	100	0	0	0	1	50	50	308	2	0	10	2	5	6	30	0	0	0	20	0	2	9	1	5	5	0	2	9	36	3	15	2026-08-26 01:21:25.698134
22	1	15	50	0	0	20	0	1	0	0	0	0	0	50	2	0	3	2	0	3	40	10	0	1	4	4	2	7	2	10	0	0	4	20	1	1	6	2026-08-26 01:21:25.698134
23	0	0	0	0	0	0	0	0	0	0	0	0	0	0	2	0	0	0	0	0	20	0	0	0	0	0	0	1	0	0	0	0	1	5	0	1	3	2026-08-26 01:21:25.698134
24	1	0	200	10	0	200	216	0	0	0	0	0	0	126	3	0	0	2	0	0	0	0	0	0	10	0	0	1	0	0	0	2	1	5	0	1	2	2026-08-26 01:21:25.698134
25	1	40	93	8	57	86	0	0	0	0	0	0	0	200	5	0	2	3	5	3	16	0	0	0	0	3	1	8	2	0	0	3	5	28	3	3	13	2026-08-26 01:21:25.698134
26	2	19	40	0	0	50	0	0	0	0	0	0	0	0	2	0	1	2	0	0	0	0	0	0	0	0	1	2	2	0	0	5	2	10	0	3	15	2026-08-26 01:21:25.698134
27	1	27	0	0	0	0	0	0	0	0	0	0	0	200	2	0	5	2	0	2	150	30	1	0	0	2	1	0	1	0	0	0	1	0	0	3	15	2026-08-26 01:21:25.698134
28	2	45	46	5	0	0	0	0	1	0	0	90	100	71	3	0	0	0	0	0	0	0	0	0	0	0	0	1	1	3	0	2	2	7	0	1	7	2026-08-26 01:21:25.698134
29	2	0	35	5	0	20	0	0	0	0	0	0	0	120	6	1	3	2	5	1	0	0	2	0	0	15	7	35	2	10	0	0	4	220	15	6	30	2026-08-26 01:21:25.698134
30	4	162	655	4	650	105	0	1	1	2	5	175	139	593	3	0	2	1	2	2	25	0	1	0	2	7	2	221	2	7	0	0	2	8	9	3	15	2026-08-26 01:21:25.698134
31	1	20	40	1	0	0	0	1	1	0	0	30	20	40	2	0	1	2	0	2	30	0	0	2	0	0	1	5	2	11	0	5	7	35	0	3	15	2026-08-26 01:21:25.698134
\.


--
-- TOC entry 5351 (class 0 OID 16402)
-- Dependencies: 222
-- Data for Name: branches; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.branches (branch_id, branch_name, is_active, created_at, has_geographic_scope, address, latitude, longitude) FROM stdin;
6	اسوان	t	2026-08-25 02:05:00.599882	t	شارع شرق البندر	24.086889	32.898526
7	اسيوط	t	2026-08-25 02:05:00.599882	t	شارع الشرطة	27.180896	31.185753
8	الاسكندرية	t	2026-08-25 02:05:00.599882	t	طريق الحرية، العطارين	31.216401	29.942454
9	الاسماعيلية	t	2026-08-25 02:05:00.599882	t	شارع التحرير	30.591850	32.269326
10	الاقصر	t	2026-08-25 02:05:00.599882	t	المركز الحضري، سيالة بدران، الكرنك	25.723009	32.657081
11	البحر الاحمر	t	2026-08-25 02:05:00.599882	t	شارع الحجاز، الغردقة	27.247248	33.820993
12	البحيرة	t	2026-08-25 02:05:00.599882	t	شارع عبد السلام الشاذلي، دمنهور	31.036081	30.466542
13	الجيزة	t	2026-08-25 02:05:00.599882	t	شارع الجيزة، الدقي	30.034636	31.216091
14	الدقهلية	t	2026-08-25 02:05:00.599882	t	شارع قناة السويس، المنصورة	31.042784	31.393437
15	السويس	t	2026-08-25 02:05:00.599882	t	شارع الجيش، السويس	29.972230	32.535805
16	الشرقية	t	2026-08-25 02:05:00.599882	t	شارع سعد زغلول، الزقازيق	30.584992	31.503460
17	الغربية	t	2026-08-25 02:05:00.599882	t	شارع البحر، طنطا	30.793740	30.999516
18	الفيوم	t	2026-08-25 02:05:00.599882	t	شارع جمال عبد الناصر، الفيوم	29.309048	30.842795
20	القليوبية	t	2026-08-25 02:05:00.599882	t	شارع فريد ندا، بنها	30.468249	31.176465
21	المنوفية	t	2026-08-25 02:05:00.599882	t	شارع جمال عبد الناصر، شبين الكوم	30.559779	31.011388
22	المنيا	t	2026-08-25 02:05:00.599882	t	شارع كورنيش النيل، المنيا	28.093113	30.760193
23	الوادي الجديد	t	2026-08-25 02:05:00.599882	t	شارع جمال عبد الناصر، الخارجة	25.441460	30.548483
24	بنى سويف	t	2026-08-25 02:05:00.599882	t	شارع كورنيش النيل، بني سويف	29.073405	31.099197
25	بورسعيد	t	2026-08-25 02:05:00.599882	t	شارع 23 يوليو، بورسعيد	31.266224	32.302307
26	جنوب سيناء	t	2026-08-25 02:05:00.599882	t	شارع السلام، شرم الشيخ	27.915053	34.329241
27	دمياط	t	2026-08-25 02:05:00.599882	t	شارع التحرير، دمياط	31.417243	31.815259
28	سوهاج	t	2026-08-25 02:05:00.599882	t	شارع كورنيش النيل، سوهاج	26.559281	31.696773
29	شمال سيناء	t	2026-08-25 02:05:00.599882	t	شارع 23 يوليو، العريش	31.131109	33.801648
30	قنا	t	2026-08-25 02:05:00.599882	t	شارع 23 يوليو، قنا	26.166113	32.715369
31	كفر الشيخ	t	2026-08-25 02:05:00.599882	t	شارع الجيش، كفر الشيخ	31.111812	30.939223
32	مرسي مطروح	t	2026-08-25 02:05:00.599882	t	شارع كورنيش النيل، مرسى مطروح	31.353381	27.236746
19	المركز العام	t	2026-08-25 02:05:00.599882	t	امتداد شارع عبد الرازق السنهوري، مدينة نصر	30.055375	31.238497
\.


--
-- TOC entry 5398 (class 0 OID 17182)
-- Dependencies: 269
-- Data for Name: egypt_earthquakes; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.egypt_earthquakes (eq_id, date, "time", magnitude, depth_km, region, longitude, latitude, created_at) FROM stdin;
\.


--
-- TOC entry 5394 (class 0 OID 17153)
-- Dependencies: 265
-- Data for Name: global_disasters; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.global_disasters (disaster_id, incident_date, incident_month, news_title, country, disaster_type, affected_areas, at_risk_areas, source_name, injured_count, deaths_count, missing_count, national_societies_interventions, news_link, news_updates, data_entry_name, notes, created_at) FROM stdin;
\.


--
-- TOC entry 5396 (class 0 OID 17169)
-- Dependencies: 267
-- Data for Name: global_earthquakes; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.global_earthquakes (eq_id, date, month, "time", country, magnitude, depth_km, region, status, longitude, latitude, created_at) FROM stdin;
\.


--
-- TOC entry 5367 (class 0 OID 16609)
-- Dependencies: 238
-- Data for Name: governorates; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.governorates (governorate_id, governorate_name, is_active, created_at) FROM stdin;
2	الجيزة	t	2026-08-08 21:26:41.502206
3	القليوبية	t	2026-08-08 21:26:41.502206
4	الاسكندرية	t	2026-08-08 21:26:41.502206
5	مطروح	t	2026-08-08 21:26:41.502206
6	البحيرة	t	2026-08-08 21:26:41.502206
7	جنوب سيناء	t	2026-08-08 21:26:41.502206
8	شمال سيناء	t	2026-08-08 21:26:41.502206
9	السويس	t	2026-08-08 21:26:41.502206
10	الشرقية	t	2026-08-08 21:26:41.502206
11	الاسماعيلية	t	2026-08-08 21:26:41.502206
12	بور سعيد	t	2026-08-08 21:26:41.502206
13	المنوفية	t	2026-08-08 21:26:41.502206
14	الغربية	t	2026-08-08 21:26:41.502206
15	الدقهلية	t	2026-08-08 21:26:41.502206
16	كفر الشيخ	t	2026-08-08 21:26:41.502206
17	دمياط	t	2026-08-08 21:26:41.502206
18	المنيا	t	2026-08-08 21:26:41.502206
19	بني سويف	t	2026-08-08 21:26:41.502206
20	الفيوم	t	2026-08-08 21:26:41.502206
21	اسيوط	t	2026-08-08 21:26:41.502206
22	الوادي الجديد	t	2026-08-08 21:26:41.502206
23	سوهاج	t	2026-08-08 21:26:41.502206
24	اسوان	t	2026-08-08 21:26:41.502206
25	الاقصر	t	2026-08-08 21:26:41.502206
26	البحر الاحمر	t	2026-08-08 21:26:41.502206
27	قنا	t	2026-08-08 21:26:41.502206
1	المركز العام	t	2026-08-08 21:26:41.502206
\.


--
-- TOC entry 5392 (class 0 OID 17128)
-- Dependencies: 263
-- Data for Name: local_news; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.local_news (news_id, branch_id, incident_date, incident_month, incident_description, news_type, news_publisher, street_name, area_name, governorate, is_reported, report_time, is_responded, branch_response_text, response_time, response_time_points, response_duration, is_field_response, movement_time, report_to_movement_duration, movement_points, field_arrival_time, distance_km, field_response_points, report_to_arrival_duration, intervention_type, intervening_branch, mission_form_name, participants_count, hospital_name, injured_count, deaths_count, news_updates, news_link, data_entry_name, notes, created_at) FROM stdin;
\.


--
-- TOC entry 5388 (class 0 OID 17088)
-- Dependencies: 259
-- Data for Name: mission_beneficiaries; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.mission_beneficiaries (beneficiary_id, mission_id, category_name, direct_count, indirect_count) FROM stdin;
17	9	مصابين	10	2500
18	9	دعم نفسي	200	0
19	9	توزيع شنط حماية شخصية	50	0
34	11	تعريف بالهلال	150	0
35	11	متبرعين	5	0
\.


--
-- TOC entry 5390 (class 0 OID 17103)
-- Dependencies: 261
-- Data for Name: mission_eoc_staff; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.mission_eoc_staff (staff_id, mission_id, role_name, staff_name) FROM stdin;
64	11	مسؤول المتابعة	تنمية الموارد
65	11	المشرف	محمد ربيع
66	11	المشرف المراجع	محمد ربيع
67	11	الجوكر	احمد كريم
68	11	معبئ الاستمارة	احمد كريم
69	11	مستكمل الاستمارة	احمد كريم
70	11	مراجع الاستمارة	احمد كريم
\.


--
-- TOC entry 5382 (class 0 OID 17044)
-- Dependencies: 253
-- Data for Name: mission_itineraries; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.mission_itineraries (itinerary_id, mission_id, route_to, departure_time, arrival_time, group_title) FROM stdin;
22	9	من سيتي ستارز الى المسجد	\N	\N	خط سير المشارك رقم 4
23	9	من المسجد الى سيتي ستارز	\N	\N	خط سير المشارك رقم 4
38	11	من المركز العام الى مكتب التراخيص	08:00:00	08:15:00	خط السير الأساسي
39	11	ساعة الانتهاء	\N	18:00:00	خط السير الأساسي
\.


--
-- TOC entry 5377 (class 0 OID 16809)
-- Dependencies: 248
-- Data for Name: mission_logs; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.mission_logs (log_id, mission_id, branch_id, communication_method, log_date, log_time, action_status, notes, created_by, created_at) FROM stdin;
\.


--
-- TOC entry 5355 (class 0 OID 16490)
-- Dependencies: 226
-- Data for Name: mission_participant_sessions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.mission_participant_sessions (session_id, participant_id, session_date, check_in_time, check_out_time, notes, created_at) FROM stdin;
\.


--
-- TOC entry 5386 (class 0 OID 17070)
-- Dependencies: 257
-- Data for Name: mission_participants; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.mission_participants (participant_id, mission_id, participant_type, full_name, participation_role, branch_id, assigned_itinerary, team_name, team_code, return_status, phase_name, stay_type) FROM stdin;
12	11	volunteer	عصماء محمد	12	19	خط السير الأساسي	تنمية الموارد	123	مازال بالمهمة	اليوم الأول	ذهاب وعودة
\.


--
-- TOC entry 5373 (class 0 OID 16679)
-- Dependencies: 244
-- Data for Name: mission_status_history; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.mission_status_history (history_id, mission_id, previous_status, new_status, action, action_by, action_at, reason) FROM stdin;
\.


--
-- TOC entry 5384 (class 0 OID 17057)
-- Dependencies: 255
-- Data for Name: mission_vehicles; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.mission_vehicles (vehicle_id, mission_id, driver_name, vehicle_number) FROM stdin;
9	9	محمد ربيع	123
17	11	محمد ربيع	123
\.


--
-- TOC entry 5380 (class 0 OID 17021)
-- Dependencies: 251
-- Data for Name: missions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.missions (mission_id, mission_code, mission_name, branch_id, mission_type, mission_location, responsible_person, data_source, status, exit_date, departure_date, arrival_date, return_date, completion_date, start_time, departure_time, arrival_time, completion_time, injured_count, indirect_beneficiaries_total, notes, internal_notes, created_at, mission_classification) FROM stdin;
11	#MSN-260826-061449	استمراة مهمة تنمية موارد - مكتب التراخيص	19	تنمية موارد	مكتب التراخيص	احمد كريم	واتساب	Completed	2026-08-26	2026-08-26	2026-08-26	2026-08-26	2026-08-26	08:00:00	08:00:00	08:15:00	18:20:00	0	0	[حالة الميدان: نشطة]\nتم التحرك بالمواصلات العامة		2026-08-26 06:14:49.208725	عادية
9	#MSN-260826-034931	استمارة مهمة تأمين - مول سيتي ستارز	19	تأمين	مول سيتي ستارز	محمد ربيع	واتساب	Completed	\N	\N	\N	\N	\N	\N	\N	\N	\N	0	0	[حالة الميدان: نشطة الآن]\n		2026-08-26 03:49:31.758602	عادية
10	#MSN-260826-042137	استمارة مهمة تأمين - مول سيتي ستارز	11				واتساب	Completed	\N	\N	\N	\N	\N	\N	\N	\N	\N	0	0	[حالة الميدان: نشطة]\n		2026-08-26 04:21:37.368876	عادية
\.


--
-- TOC entry 5361 (class 0 OID 16548)
-- Dependencies: 232
-- Data for Name: permissions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.permissions (permission_id, permission_code, description, created_at) FROM stdin;
1	mission.view	View missions	2026-08-08 20:42:16.148026
2	mission.create	Create a new mission	2026-08-08 20:42:16.148026
3	mission.edit	Edit a mission	2026-08-08 20:42:16.148026
4	mission.submit	Submit a mission for review	2026-08-08 20:42:16.148026
5	mission.complete	Complete a mission	2026-08-08 20:42:16.148026
6	mission.review	Review a mission	2026-08-08 20:42:16.148026
7	mission.approve	Approve a mission	2026-08-08 20:42:16.148026
8	mission.return	Return a mission for correction	2026-08-08 20:42:16.148026
9	mission.cancel	Cancel a mission	2026-08-08 20:42:16.148026
10	users.view	\N	2026-08-09 00:02:15.168696
11	volunteer.create	\N	2026-08-09 19:27:50.041345
12	mission.participant.add	\N	2026-08-09 19:43:05.310573
14	mission.participant.edit	Edit participant attendance	2026-08-09 23:11:56.801537
15	mission.participant.remove	Remove mission participant	2026-08-09 23:11:56.801537
16	mission.history.view	View mission history	2026-08-09 23:11:56.801537
17	mission.final_review	Final review of completed missions	2026-08-09 23:33:19.420798
18	mission.delete	Delete draft or returned missions	2026-08-09 23:33:37.943801
19	mission.archive	Archive missions	2026-08-09 23:33:37.943801
20	mission.archive.delete	Delete archived missions permanently	2026-08-09 23:33:37.943801
21	users.create	\N	2026-08-14 20:24:41.919808
22	users.edit	\N	2026-08-14 20:24:41.919808
23	users.status	\N	2026-08-14 20:24:41.919808
24	users.role.edit	\N	2026-08-14 20:24:41.919808
25	users.branches.edit	\N	2026-08-14 20:24:41.919808
\.


--
-- TOC entry 5365 (class 0 OID 16585)
-- Dependencies: 236
-- Data for Name: role_inheritance; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.role_inheritance (role_inheritance_id, parent_role_id, child_role_id, created_at) FROM stdin;
1	1	2	2026-08-08 20:48:57.91311
2	2	3	2026-08-08 20:48:57.91311
3	3	4	2026-08-08 20:48:57.91311
4	4	5	2026-08-08 20:48:57.91311
\.


--
-- TOC entry 5363 (class 0 OID 16562)
-- Dependencies: 234
-- Data for Name: role_permissions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.role_permissions (role_permission_id, role_id, permission_id, created_at) FROM stdin;
1	1	1	2026-08-08 20:43:12.082787
2	1	2	2026-08-08 20:43:12.082787
3	1	3	2026-08-08 20:43:12.082787
4	1	4	2026-08-08 20:43:12.082787
6	2	1	2026-08-08 20:44:29.586967
7	2	2	2026-08-08 20:44:29.586967
8	2	3	2026-08-08 20:44:29.586967
9	2	4	2026-08-08 20:44:29.586967
10	2	5	2026-08-08 20:44:29.586967
11	2	6	2026-08-08 20:44:29.586967
12	2	8	2026-08-08 20:44:29.586967
13	5	10	2026-08-09 00:02:38.708653
14	5	6	2026-08-09 18:01:35.828295
15	5	8	2026-08-09 18:01:35.828295
16	5	7	2026-08-09 18:01:35.828295
17	5	9	2026-08-09 18:01:35.828295
18	5	3	2026-08-09 18:01:35.828295
19	5	1	2026-08-09 18:01:35.828295
20	5	4	2026-08-09 18:01:35.828295
21	5	2	2026-08-09 18:01:35.828295
22	5	5	2026-08-09 18:01:35.828295
23	1	11	2026-08-09 19:27:56.776105
24	5	11	2026-08-09 19:27:56.776105
25	1	12	2026-08-09 19:43:10.852416
26	5	12	2026-08-09 19:43:10.852416
27	1	14	2026-08-09 23:16:12.922842
28	1	16	2026-08-09 23:16:12.922842
29	2	14	2026-08-09 23:16:12.922842
30	2	15	2026-08-09 23:16:12.922842
31	2	16	2026-08-09 23:16:12.922842
32	5	14	2026-08-09 23:16:12.922842
33	5	15	2026-08-09 23:16:12.922842
34	5	16	2026-08-09 23:16:12.922842
35	3	17	2026-08-09 23:33:27.634556
36	3	18	2026-08-09 23:33:43.608712
37	4	19	2026-08-09 23:33:50.425838
38	5	20	2026-08-09 23:33:56.273255
39	5	19	2026-08-09 23:35:23.179781
43	2	7	2026-08-10 12:50:13.53977
44	3	19	2026-08-10 14:04:45.281797
46	5	25	2026-08-14 20:24:41.919808
47	5	21	2026-08-14 20:24:41.919808
48	5	24	2026-08-14 20:24:41.919808
49	5	23	2026-08-14 20:24:41.919808
50	5	22	2026-08-14 20:24:41.919808
\.


--
-- TOC entry 5357 (class 0 OID 16511)
-- Dependencies: 228
-- Data for Name: roles; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.roles (role_id, role_name, description, created_at) FROM stdin;
1	Operation	Operations user	2026-08-08 17:52:48.428681
2	Joker	Operations reviewer	2026-08-08 17:52:48.428681
3	Supervisor	Operations supervisor	2026-08-08 17:52:48.428681
4	Manager	Operations manager	2026-08-08 17:52:48.428681
5	OWNER	Full system administrator	2026-08-08 17:52:48.428681
\.


--
-- TOC entry 5371 (class 0 OID 16647)
-- Dependencies: 242
-- Data for Name: user_branches; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.user_branches (user_branch_id, user_id, branch_id, created_at) FROM stdin;
18	15	19	2026-08-25 03:40:39.495431
20	14	19	2026-08-25 03:40:39.495431
21	3	19	2026-08-25 03:40:39.495431
22	13	19	2026-08-25 03:40:39.495431
19	12	17	2026-08-25 03:40:39.495431
23	11	9	2026-08-25 03:40:39.495431
17	10	7	2026-08-25 03:40:39.495431
\.


--
-- TOC entry 5359 (class 0 OID 16525)
-- Dependencies: 230
-- Data for Name: user_roles; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.user_roles (user_role_id, user_id, role_id, created_at) FROM stdin;
1	1	5	2026-08-08 21:35:22.553274
2	3	1	2026-08-09 02:26:10.978824
7	12	1	2026-08-10 11:20:50.700672
8	11	1	2026-08-10 11:20:50.700672
9	10	1	2026-08-10 11:20:50.700672
10	13	2	2026-08-10 11:20:50.700672
11	14	3	2026-08-10 11:20:50.700672
12	15	4	2026-08-10 11:20:50.700672
\.


--
-- TOC entry 5349 (class 0 OID 16386)
-- Dependencies: 220
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.users (user_id, full_name, username, role, is_active, created_at, password_hash) FROM stdin;
1	Mohamed Rabea	mrabea.x	Rabea	t	2026-08-08 21:35:00.345712	$argon2id$v=19$m=65536,t=3,p=4$mt/j1RCjkxGOb+GiEfSRWg$DGIPhywChc+mh2G9p9ADLFgWuPeY59SFLO4HiHFK6KM
13	Joker	joker	Joker	t	2026-08-10 11:20:50.700672	$argon2id$v=19$m=65536,t=3,p=4$X30YKMLG8BbBMVDhi74nIQ$nVY1KFgObvOvGzB1koJYWWNckiw8kwYqW6m7D34++cQ
3	Operation HQ	operation.HQ	Operation	t	2026-08-09 02:26:10.978824	$argon2id$v=19$m=65536,t=3,p=4$di9EYlDdXGZGW7gew4/0/g$NjPvvuwNySMcY/b5DSDxc2fE4L060pBcC/sur91b2CA
10	Operation Upper	operation.upper	Operation	t	2026-08-10 11:20:50.700672	$argon2id$v=19$m=65536,t=3,p=4$VwhNJX+DEPH+h2Jib6b0XA$cEZUI0rRhAfbjEAAUo50Odv0r1C9cfTucKxi0NOc7uQ
11	Operation Canal	operation.canal	Operation	t	2026-08-10 11:20:50.700672	$argon2id$v=19$m=65536,t=3,p=4$h/aL75MwYTJnxtN7Iybkyg$xJ3b+pRTk9YDwHz2mADtsGQHcZ6W0VND5GgLkoUSuE8
12	Operation Delta	operation.delta	Operation	t	2026-08-10 11:20:50.700672	$argon2id$v=19$m=65536,t=3,p=4$nEYJZ/G+I5vMjf+UstnEjQ$HzqNI/QSIHcxakhoMXhjLTV35IRS1qnGQqZ1WSgxsvM
14	Supervisor	supervisor	Supervisor	t	2026-08-10 11:20:50.700672	$argon2id$v=19$m=65536,t=3,p=4$x7YU8KICvO9U/6+7AHrbwA$enNrNR8sk0D/qqJirixdta9d3lW+MoACyAiOK41LhBI
15	Manager	manager	Manager	t	2026-08-10 11:20:50.700672	$argon2id$v=19$m=65536,t=3,p=4$WlDVhxUM5yw3JWfvFLpr8g$uwc/ZsYjNj2b4GlHXB7F4woJg7PHlp8iMK5tKKO/4nk
\.


--
-- TOC entry 5353 (class 0 OID 16448)
-- Dependencies: 224
-- Data for Name: volunteers; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.volunteers (volunteer_id, full_name, phone, branch_id, is_active, created_at, membership_number, status_mode, last_check_in_at) FROM stdin;
\.


--
-- TOC entry 5418 (class 0 OID 0)
-- Dependencies: 270
-- Name: ai_news_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.ai_news_id_seq', 1, false);


--
-- TOC entry 5419 (class 0 OID 0)
-- Dependencies: 245
-- Name: audit_logs_audit_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.audit_logs_audit_id_seq', 2, true);


--
-- TOC entry 5420 (class 0 OID 0)
-- Dependencies: 239
-- Name: branch_governorates_branch_governorate_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.branch_governorates_branch_governorate_id_seq', 27, true);


--
-- TOC entry 5421 (class 0 OID 0)
-- Dependencies: 221
-- Name: branches_branch_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.branches_branch_id_seq', 32, true);


--
-- TOC entry 5422 (class 0 OID 0)
-- Dependencies: 268
-- Name: egypt_earthquakes_eq_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.egypt_earthquakes_eq_id_seq', 1, false);


--
-- TOC entry 5423 (class 0 OID 0)
-- Dependencies: 264
-- Name: global_disasters_disaster_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.global_disasters_disaster_id_seq', 1, false);


--
-- TOC entry 5424 (class 0 OID 0)
-- Dependencies: 266
-- Name: global_earthquakes_eq_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.global_earthquakes_eq_id_seq', 1, false);


--
-- TOC entry 5425 (class 0 OID 0)
-- Dependencies: 237
-- Name: governorates_governorate_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.governorates_governorate_id_seq', 27, true);


--
-- TOC entry 5426 (class 0 OID 0)
-- Dependencies: 262
-- Name: local_news_news_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.local_news_news_id_seq', 1, false);


--
-- TOC entry 5427 (class 0 OID 0)
-- Dependencies: 258
-- Name: mission_beneficiaries_beneficiary_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.mission_beneficiaries_beneficiary_id_seq', 35, true);


--
-- TOC entry 5428 (class 0 OID 0)
-- Dependencies: 260
-- Name: mission_eoc_staff_staff_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.mission_eoc_staff_staff_id_seq', 70, true);


--
-- TOC entry 5429 (class 0 OID 0)
-- Dependencies: 252
-- Name: mission_itineraries_itinerary_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.mission_itineraries_itinerary_id_seq', 39, true);


--
-- TOC entry 5430 (class 0 OID 0)
-- Dependencies: 247
-- Name: mission_logs_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.mission_logs_log_id_seq', 1, false);


--
-- TOC entry 5431 (class 0 OID 0)
-- Dependencies: 225
-- Name: mission_participant_sessions_session_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.mission_participant_sessions_session_id_seq', 1, false);


--
-- TOC entry 5432 (class 0 OID 0)
-- Dependencies: 256
-- Name: mission_participants_participant_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.mission_participants_participant_id_seq', 12, true);


--
-- TOC entry 5433 (class 0 OID 0)
-- Dependencies: 243
-- Name: mission_status_history_history_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.mission_status_history_history_id_seq', 1, false);


--
-- TOC entry 5434 (class 0 OID 0)
-- Dependencies: 254
-- Name: mission_vehicles_vehicle_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.mission_vehicles_vehicle_id_seq', 17, true);


--
-- TOC entry 5435 (class 0 OID 0)
-- Dependencies: 250
-- Name: missions_mission_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.missions_mission_id_seq', 11, true);


--
-- TOC entry 5436 (class 0 OID 0)
-- Dependencies: 231
-- Name: permissions_permission_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.permissions_permission_id_seq', 25, true);


--
-- TOC entry 5437 (class 0 OID 0)
-- Dependencies: 235
-- Name: role_inheritance_role_inheritance_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.role_inheritance_role_inheritance_id_seq', 4, true);


--
-- TOC entry 5438 (class 0 OID 0)
-- Dependencies: 233
-- Name: role_permissions_role_permission_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.role_permissions_role_permission_id_seq', 50, true);


--
-- TOC entry 5439 (class 0 OID 0)
-- Dependencies: 227
-- Name: roles_role_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.roles_role_id_seq', 5, true);


--
-- TOC entry 5440 (class 0 OID 0)
-- Dependencies: 241
-- Name: user_branches_user_branch_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.user_branches_user_branch_id_seq', 23, true);


--
-- TOC entry 5441 (class 0 OID 0)
-- Dependencies: 229
-- Name: user_roles_user_role_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.user_roles_user_role_id_seq', 12, true);


--
-- TOC entry 5442 (class 0 OID 0)
-- Dependencies: 219
-- Name: users_user_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.users_user_id_seq', 15, true);


--
-- TOC entry 5443 (class 0 OID 0)
-- Dependencies: 223
-- Name: volunteers_volunteer_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.volunteers_volunteer_id_seq', 1, false);


--
-- TOC entry 5176 (class 2606 OID 17202)
-- Name: ai_news ai_news_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_news
    ADD CONSTRAINT ai_news_pkey PRIMARY KEY (id);


--
-- TOC entry 5148 (class 2606 OID 16747)
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (audit_id);


--
-- TOC entry 5137 (class 2606 OID 16634)
-- Name: branch_governorates branch_governorates_branch_id_governorate_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.branch_governorates
    ADD CONSTRAINT branch_governorates_branch_id_governorate_id_key UNIQUE (branch_id, governorate_id);


--
-- TOC entry 5139 (class 2606 OID 16632)
-- Name: branch_governorates branch_governorates_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.branch_governorates
    ADD CONSTRAINT branch_governorates_pkey PRIMARY KEY (branch_governorate_id);


--
-- TOC entry 5152 (class 2606 OID 17001)
-- Name: branch_inventory branch_inventory_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.branch_inventory
    ADD CONSTRAINT branch_inventory_pkey PRIMARY KEY (branch_id);


--
-- TOC entry 5100 (class 2606 OID 16414)
-- Name: branches branches_branch_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_branch_name_key UNIQUE (branch_name);


--
-- TOC entry 5102 (class 2606 OID 16412)
-- Name: branches branches_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_pkey PRIMARY KEY (branch_id);


--
-- TOC entry 5174 (class 2606 OID 17191)
-- Name: egypt_earthquakes egypt_earthquakes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.egypt_earthquakes
    ADD CONSTRAINT egypt_earthquakes_pkey PRIMARY KEY (eq_id);


--
-- TOC entry 5170 (class 2606 OID 17167)
-- Name: global_disasters global_disasters_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.global_disasters
    ADD CONSTRAINT global_disasters_pkey PRIMARY KEY (disaster_id);


--
-- TOC entry 5172 (class 2606 OID 17180)
-- Name: global_earthquakes global_earthquakes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.global_earthquakes
    ADD CONSTRAINT global_earthquakes_pkey PRIMARY KEY (eq_id);


--
-- TOC entry 5133 (class 2606 OID 16621)
-- Name: governorates governorates_governorate_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.governorates
    ADD CONSTRAINT governorates_governorate_name_key UNIQUE (governorate_name);


--
-- TOC entry 5135 (class 2606 OID 16619)
-- Name: governorates governorates_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.governorates
    ADD CONSTRAINT governorates_pkey PRIMARY KEY (governorate_id);


--
-- TOC entry 5168 (class 2606 OID 17146)
-- Name: local_news local_news_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.local_news
    ADD CONSTRAINT local_news_pkey PRIMARY KEY (news_id);


--
-- TOC entry 5164 (class 2606 OID 17096)
-- Name: mission_beneficiaries mission_beneficiaries_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mission_beneficiaries
    ADD CONSTRAINT mission_beneficiaries_pkey PRIMARY KEY (beneficiary_id);


--
-- TOC entry 5166 (class 2606 OID 17109)
-- Name: mission_eoc_staff mission_eoc_staff_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mission_eoc_staff
    ADD CONSTRAINT mission_eoc_staff_pkey PRIMARY KEY (staff_id);


--
-- TOC entry 5158 (class 2606 OID 17050)
-- Name: mission_itineraries mission_itineraries_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mission_itineraries
    ADD CONSTRAINT mission_itineraries_pkey PRIMARY KEY (itinerary_id);


--
-- TOC entry 5150 (class 2606 OID 16821)
-- Name: mission_logs mission_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mission_logs
    ADD CONSTRAINT mission_logs_pkey PRIMARY KEY (log_id);


--
-- TOC entry 5109 (class 2606 OID 16503)
-- Name: mission_participant_sessions mission_participant_sessions_participant_id_session_date_ch_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mission_participant_sessions
    ADD CONSTRAINT mission_participant_sessions_participant_id_session_date_ch_key UNIQUE (participant_id, session_date, check_in_time);


--
-- TOC entry 5111 (class 2606 OID 16501)
-- Name: mission_participant_sessions mission_participant_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mission_participant_sessions
    ADD CONSTRAINT mission_participant_sessions_pkey PRIMARY KEY (session_id);


--
-- TOC entry 5162 (class 2606 OID 17076)
-- Name: mission_participants mission_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mission_participants
    ADD CONSTRAINT mission_participants_pkey PRIMARY KEY (participant_id);


--
-- TOC entry 5146 (class 2606 OID 16695)
-- Name: mission_status_history mission_status_history_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mission_status_history
    ADD CONSTRAINT mission_status_history_pkey PRIMARY KEY (history_id);


--
-- TOC entry 5160 (class 2606 OID 17063)
-- Name: mission_vehicles mission_vehicles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mission_vehicles
    ADD CONSTRAINT mission_vehicles_pkey PRIMARY KEY (vehicle_id);


--
-- TOC entry 5154 (class 2606 OID 17037)
-- Name: missions missions_mission_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.missions
    ADD CONSTRAINT missions_mission_code_key UNIQUE (mission_code);


--
-- TOC entry 5156 (class 2606 OID 17035)
-- Name: missions missions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.missions
    ADD CONSTRAINT missions_pkey PRIMARY KEY (mission_id);


--
-- TOC entry 5121 (class 2606 OID 16560)
-- Name: permissions permissions_permission_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_permission_code_key UNIQUE (permission_code);


--
-- TOC entry 5123 (class 2606 OID 16558)
-- Name: permissions permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_pkey PRIMARY KEY (permission_id);


--
-- TOC entry 5129 (class 2606 OID 16597)
-- Name: role_inheritance role_inheritance_parent_role_id_child_role_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.role_inheritance
    ADD CONSTRAINT role_inheritance_parent_role_id_child_role_id_key UNIQUE (parent_role_id, child_role_id);


--
-- TOC entry 5131 (class 2606 OID 16595)
-- Name: role_inheritance role_inheritance_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.role_inheritance
    ADD CONSTRAINT role_inheritance_pkey PRIMARY KEY (role_inheritance_id);


--
-- TOC entry 5125 (class 2606 OID 16571)
-- Name: role_permissions role_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (role_permission_id);


--
-- TOC entry 5127 (class 2606 OID 16573)
-- Name: role_permissions role_permissions_role_id_permission_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_role_id_permission_id_key UNIQUE (role_id, permission_id);


--
-- TOC entry 5113 (class 2606 OID 16521)
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (role_id);


--
-- TOC entry 5115 (class 2606 OID 16523)
-- Name: roles roles_role_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_role_name_key UNIQUE (role_name);


--
-- TOC entry 5141 (class 2606 OID 16656)
-- Name: user_branches user_branches_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_branches
    ADD CONSTRAINT user_branches_pkey PRIMARY KEY (user_branch_id);


--
-- TOC entry 5143 (class 2606 OID 16658)
-- Name: user_branches user_branches_user_id_branch_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_branches
    ADD CONSTRAINT user_branches_user_id_branch_id_key UNIQUE (user_id, branch_id);


--
-- TOC entry 5117 (class 2606 OID 16534)
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (user_role_id);


--
-- TOC entry 5119 (class 2606 OID 16536)
-- Name: user_roles user_roles_user_id_role_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_role_id_key UNIQUE (user_id, role_id);


--
-- TOC entry 5096 (class 2606 OID 16398)
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (user_id);


--
-- TOC entry 5098 (class 2606 OID 16400)
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- TOC entry 5105 (class 2606 OID 16715)
-- Name: volunteers volunteers_membership_number_branch_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.volunteers
    ADD CONSTRAINT volunteers_membership_number_branch_unique UNIQUE (membership_number, branch_id);


--
-- TOC entry 5107 (class 2606 OID 16458)
-- Name: volunteers volunteers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.volunteers
    ADD CONSTRAINT volunteers_pkey PRIMARY KEY (volunteer_id);


--
-- TOC entry 5144 (class 1259 OID 16706)
-- Name: mission_status_history_mission_id_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX mission_status_history_mission_id_index ON public.mission_status_history USING btree (mission_id, action_at DESC);


--
-- TOC entry 5103 (class 1259 OID 16761)
-- Name: volunteers_auto_status_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX volunteers_auto_status_index ON public.volunteers USING btree (status_mode, last_check_in_at);


--
-- TOC entry 5189 (class 2606 OID 16748)
-- Name: audit_logs audit_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- TOC entry 5184 (class 2606 OID 16635)
-- Name: branch_governorates branch_governorates_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.branch_governorates
    ADD CONSTRAINT branch_governorates_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(branch_id) ON DELETE CASCADE;


--
-- TOC entry 5185 (class 2606 OID 16640)
-- Name: branch_governorates branch_governorates_governorate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.branch_governorates
    ADD CONSTRAINT branch_governorates_governorate_id_fkey FOREIGN KEY (governorate_id) REFERENCES public.governorates(governorate_id) ON DELETE CASCADE;


--
-- TOC entry 5192 (class 2606 OID 17002)
-- Name: branch_inventory branch_inventory_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.branch_inventory
    ADD CONSTRAINT branch_inventory_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(branch_id) ON DELETE CASCADE;


--
-- TOC entry 5200 (class 2606 OID 17147)
-- Name: local_news local_news_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.local_news
    ADD CONSTRAINT local_news_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(branch_id);


--
-- TOC entry 5198 (class 2606 OID 17097)
-- Name: mission_beneficiaries mission_beneficiaries_mission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mission_beneficiaries
    ADD CONSTRAINT mission_beneficiaries_mission_id_fkey FOREIGN KEY (mission_id) REFERENCES public.missions(mission_id) ON DELETE CASCADE;


--
-- TOC entry 5199 (class 2606 OID 17110)
-- Name: mission_eoc_staff mission_eoc_staff_mission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mission_eoc_staff
    ADD CONSTRAINT mission_eoc_staff_mission_id_fkey FOREIGN KEY (mission_id) REFERENCES public.missions(mission_id) ON DELETE CASCADE;


--
-- TOC entry 5194 (class 2606 OID 17051)
-- Name: mission_itineraries mission_itineraries_mission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mission_itineraries
    ADD CONSTRAINT mission_itineraries_mission_id_fkey FOREIGN KEY (mission_id) REFERENCES public.missions(mission_id) ON DELETE CASCADE;


--
-- TOC entry 5190 (class 2606 OID 16827)
-- Name: mission_logs mission_logs_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mission_logs
    ADD CONSTRAINT mission_logs_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(branch_id) ON DELETE SET NULL;


--
-- TOC entry 5191 (class 2606 OID 16832)
-- Name: mission_logs mission_logs_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mission_logs
    ADD CONSTRAINT mission_logs_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- TOC entry 5196 (class 2606 OID 17082)
-- Name: mission_participants mission_participants_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mission_participants
    ADD CONSTRAINT mission_participants_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(branch_id);


--
-- TOC entry 5197 (class 2606 OID 17077)
-- Name: mission_participants mission_participants_mission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mission_participants
    ADD CONSTRAINT mission_participants_mission_id_fkey FOREIGN KEY (mission_id) REFERENCES public.missions(mission_id) ON DELETE CASCADE;


--
-- TOC entry 5188 (class 2606 OID 16701)
-- Name: mission_status_history mission_status_history_action_by_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mission_status_history
    ADD CONSTRAINT mission_status_history_action_by_fk FOREIGN KEY (action_by) REFERENCES public.users(user_id);


--
-- TOC entry 5195 (class 2606 OID 17064)
-- Name: mission_vehicles mission_vehicles_mission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mission_vehicles
    ADD CONSTRAINT mission_vehicles_mission_id_fkey FOREIGN KEY (mission_id) REFERENCES public.missions(mission_id) ON DELETE CASCADE;


--
-- TOC entry 5193 (class 2606 OID 17038)
-- Name: missions missions_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.missions
    ADD CONSTRAINT missions_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(branch_id);


--
-- TOC entry 5182 (class 2606 OID 16603)
-- Name: role_inheritance role_inheritance_child_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.role_inheritance
    ADD CONSTRAINT role_inheritance_child_role_id_fkey FOREIGN KEY (child_role_id) REFERENCES public.roles(role_id) ON DELETE CASCADE;


--
-- TOC entry 5183 (class 2606 OID 16598)
-- Name: role_inheritance role_inheritance_parent_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.role_inheritance
    ADD CONSTRAINT role_inheritance_parent_role_id_fkey FOREIGN KEY (parent_role_id) REFERENCES public.roles(role_id) ON DELETE CASCADE;


--
-- TOC entry 5180 (class 2606 OID 16579)
-- Name: role_permissions role_permissions_permission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES public.permissions(permission_id) ON DELETE CASCADE;


--
-- TOC entry 5181 (class 2606 OID 16574)
-- Name: role_permissions role_permissions_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(role_id) ON DELETE CASCADE;


--
-- TOC entry 5186 (class 2606 OID 16664)
-- Name: user_branches user_branches_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_branches
    ADD CONSTRAINT user_branches_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(branch_id) ON DELETE CASCADE;


--
-- TOC entry 5187 (class 2606 OID 16659)
-- Name: user_branches user_branches_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_branches
    ADD CONSTRAINT user_branches_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- TOC entry 5178 (class 2606 OID 16542)
-- Name: user_roles user_roles_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(role_id) ON DELETE CASCADE;


--
-- TOC entry 5179 (class 2606 OID 16537)
-- Name: user_roles user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- TOC entry 5177 (class 2606 OID 16459)
-- Name: volunteers volunteers_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.volunteers
    ADD CONSTRAINT volunteers_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(branch_id);


-- Completed on 2026-08-31 16:01:50

--
-- PostgreSQL database dump complete
--

\unrestrict YQHZOx72tDeF9xahUlFa1bP4vgakWrBd2DGqy6pU3irELFQbNX0yhTq9Zd1jkh5


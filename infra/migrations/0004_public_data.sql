-- 0004 · public reference data: markets, weather, forecasts, storage, transport
--
-- Runs as fasal_owner. Everything here is user-independent (Constitution §4) — the market, never
-- the farmer — so any signed-in actor may read it, and the application role may not write it.
-- The nightly pipeline loads it as the owner.

CREATE TABLE app.market_prices (
  price_date  date NOT NULL,
  district    text NOT NULL,
  market      text NOT NULL,
  crop        text NOT NULL,
  variety     text NOT NULL DEFAULT '',
  min_price   numeric(12, 2) NOT NULL CHECK (min_price > 0),
  max_price   numeric(12, 2) NOT NULL CHECK (max_price >= min_price),
  modal_price numeric(12, 2) NOT NULL CHECK (modal_price BETWEEN min_price AND max_price),
  unit        text NOT NULL DEFAULT 'quintal' CHECK (unit = 'quintal'),
  imputed     boolean NOT NULL DEFAULT false,
  outlier     boolean NOT NULL DEFAULT false,
  source      text NOT NULL,
  PRIMARY KEY (price_date, market, crop, variety)
);
CREATE INDEX market_prices_series ON app.market_prices (crop, district, price_date DESC);

CREATE TABLE app.market_arrivals (
  arrival_date    date NOT NULL,
  district        text NOT NULL,
  market          text NOT NULL,
  crop            text NOT NULL,
  arrivals_tonnes numeric(12, 2) CHECK (arrivals_tonnes >= 0),
  market_closed   boolean NOT NULL DEFAULT false,
  source          text NOT NULL,
  PRIMARY KEY (arrival_date, market, crop)
);

CREATE TABLE app.weather_observations (
  obs_date     date NOT NULL,
  district     text NOT NULL,
  rain_mm      numeric(7, 2) CHECK (rain_mm >= 0),
  humidity_pct numeric(5, 2) CHECK (humidity_pct BETWEEN 0 AND 100),
  source       text NOT NULL,
  PRIMARY KEY (obs_date, district)
);

CREATE TABLE app.weather_forecasts (
  issued_date  date NOT NULL,
  target_date  date NOT NULL CHECK (target_date >= issued_date),
  district     text NOT NULL,
  rain_mm      numeric(7, 2) CHECK (rain_mm >= 0),
  rain_prob    numeric(4, 3) CHECK (rain_prob BETWEEN 0 AND 1),
  humidity_pct numeric(5, 2) CHECK (humidity_pct BETWEEN 0 AND 100),
  source       text NOT NULL,
  PRIMARY KEY (issued_date, target_date, district)
);

CREATE TABLE app.crop_profiles (
  version    text PRIMARY KEY,
  payload    jsonb NOT NULL,
  integrity  text NOT NULL,
  loaded_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.forecast_bundles (
  crop         text NOT NULL,
  district     text NOT NULL,
  version      text NOT NULL,
  as_of        date NOT NULL,
  status       text NOT NULL CHECK (status IN ('published', 'insufficient')),
  payload      jsonb NOT NULL,
  integrity    text NOT NULL,
  generated_at timestamptz NOT NULL,
  PRIMARY KEY (crop, district, version)
);

CREATE TABLE app.raksha_signals (
  crop     text NOT NULL,
  district text NOT NULL,
  as_of    date NOT NULL,
  layer    text NOT NULL CHECK (layer IN ('RK-1', 'RK-2', 'RK-3', 'RK-4', 'RK-5', 'RK-6', 'RK-8')),
  bucket   text CHECK (bucket IN ('up', 'flat', 'down')),
  weight   numeric(8, 6) NOT NULL CHECK (weight >= 0),
  value    double precision,
  PRIMARY KEY (crop, district, as_of, layer)
);

CREATE TABLE app.storage_facilities (
  id                   text PRIMARY KEY,
  name                 text NOT NULL,
  district             text NOT NULL,
  location_lat         double precision NOT NULL CHECK (location_lat BETWEEN -90 AND 90),
  location_lon         double precision NOT NULL CHECK (location_lon BETWEEN -180 AND 180),
  capacity_available_qtl numeric(12, 1) NOT NULL CHECK (capacity_available_qtl >= 0),
  crops                text[] NOT NULL,
  rate_per_qtl_month   numeric(10, 2) NOT NULL CHECK (rate_per_qtl_month >= 0),
  spoilage_per_month   jsonb NOT NULL,
  wdra_accredited      boolean NOT NULL,
  e_nwr                boolean NOT NULL,
  pledge_rate_annual   numeric(6, 4) CHECK (pledge_rate_annual BETWEEN 0 AND 1),
  source               text NOT NULL,
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.transporters (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  district      text NOT NULL,
  vehicle_class text NOT NULL,
  capacity_kg   integer NOT NULL CHECK (capacity_kg > 0),
  rate_per_km   numeric(8, 2) NOT NULL CHECK (rate_per_km > 0),
  minimum_charge numeric(10, 2) NOT NULL CHECK (minimum_charge >= 0),
  available     boolean NOT NULL DEFAULT true,
  source        text NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['market_prices', 'market_arrivals', 'weather_observations', 'weather_forecasts', 'crop_profiles',
                           'forecast_bundles', 'raksha_signals', 'storage_facilities', 'transporters'] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON app.%I FOR SELECT USING (true)', t || '_public_read', t);
    EXECUTE format('GRANT SELECT ON app.%I TO fasal_app', t);
  END LOOP;
END;
$$;

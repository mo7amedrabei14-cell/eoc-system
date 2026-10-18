// Pure, unit-testable selectors for the Weather Intelligence page.
const toWeatherNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const hasThreshold = (value, config, key, fallback) => {
  const configuredValue = toWeatherNumber(config?.[key]?.value);
  const threshold = configuredValue ?? fallback;
  return value !== null && value >= threshold;
};

const hasMaximumThreshold = (value, config, key, fallback) => {
  const configuredValue = toWeatherNumber(config?.[key]?.value);
  const threshold = configuredValue ?? fallback;
  return value !== null && value <= threshold;
};

export function matchesWeatherPhenomenon(assessment, selectedFilter = 'all', intelConfig = {}) {
  if (selectedFilter === 'all') return true;
  if (!assessment || typeof assessment !== 'object' || Array.isArray(assessment)) return false;

  const forecast = assessment.forecast && typeof assessment.forecast === 'object'
    ? assessment.forecast
    : {};
  const weatherCode = toWeatherNumber(forecast.weather_code);
  const rainMm = toWeatherNumber(forecast.precip_mm);
  const rainChance = toWeatherNumber(forecast.precip_prob_pct);
  const maxTemp = toWeatherNumber(forecast.tmax);
  const minTemp = toWeatherNumber(forecast.tmin);
  const maxWind = toWeatherNumber(forecast.wind_max_kph);
  const gusts = toWeatherNumber(forecast.wind_gusts_kph);
  const hazardCodes = new Set(
    (Array.isArray(assessment.hazards) ? assessment.hazards : [])
      .filter((item) => item && typeof item === 'object')
      .map((item) => String(item.code ?? '').trim().toLowerCase())
      .filter(Boolean)
  );
  const hasHazard = (...codes) => codes.some((code) => hazardCodes.has(code));
  const rainCodes = [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99];
  const thunderstormCodes = [95, 96, 99];

  switch (selectedFilter) {
    case 'rain':
      return (rainMm !== null && rainMm > 0) ||
        (rainChance !== null && rainChance > 0) ||
        rainCodes.includes(weatherCode) ||
        hasHazard('heavy_rain', 'thunderstorm');
    case 'heavy_rain':
      return hasHazard('heavy_rain') ||
        [65, 67, 82].includes(weatherCode) ||
        hasThreshold(rainMm, intelConfig, 'hazard.precip_heavy_mm', 10);
    case 'thunderstorm':
      return hasHazard('thunderstorm') || thunderstormCodes.includes(weatherCode);
    case 'strong_wind':
      return hasHazard('strong_wind') ||
        hasThreshold(maxWind, intelConfig, 'hazard.wind_high_kph', 40) ||
        hasThreshold(gusts, intelConfig, 'hazard.wind_gusts_high_kph', 60);
    case 'heat':
      return hasHazard('heat') || hasThreshold(maxTemp, intelConfig, 'hazard.tmax_high_c', 40);
    case 'cold':
      return hasHazard('cold') || hasMaximumThreshold(minTemp, intelConfig, 'hazard.tmin_low_c', 5);
    case 'fog':
      return hasHazard('fog') || [45, 48].includes(weatherCode);
    case 'hazards':
      return Array.isArray(assessment.hazards) && assessment.hazards.length > 0;
    default:
      return true;
  }
}

// Empty background-poll responses must not evict populated data for the same view.
export function shouldPreserveWeatherSnapshot({
  silent,
  nextCount,
  previousCount,
  previousScopeKey,
  requestScopeKey,
}) {
  return silent === true &&
    nextCount === 0 &&
    previousCount > 0 &&
    previousScopeKey === requestScopeKey;
}

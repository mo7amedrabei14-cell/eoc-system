// Pure, unit-testable filters for the Weather Intelligence page.
// Metric categories use the same historical percentiles as the server (P10/P25/P75/P90).
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

export const WEATHER_METRIC_FILTERS = [
  { key: 'tmax', ar: 'الحرارة العظمى', en: 'Maximum temperature' },
  { key: 'tmin', ar: 'الحرارة الصغرى', en: 'Minimum temperature' },
  { key: 'precip', ar: 'كمية الأمطار', en: 'Precipitation amount' },
  { key: 'wind', ar: 'سرعة الرياح', en: 'Wind speed' },
  { key: 'gusts', ar: 'هبات الرياح', en: 'Wind gust speed' },
  { key: 'humidity', ar: 'الرطوبة', en: 'Relative humidity' },
  { key: 'cloud', ar: 'الغطاء السحابي', en: 'Cloud cover' },
  { key: 'dust', ar: 'تركيز الغبار', en: 'Dust concentration' },
  { key: 'pm25', ar: 'تلوث الهواء PM2.5', en: 'PM2.5 air pollution' },
  { key: 'wave', ar: 'ارتفاع الموج', en: 'Wave height' },
  { key: 'flood', ar: 'التصريف النهري / السيول', en: 'River discharge / flood flow' },
];

const BASE_WEATHER_FILTER_OPTIONS = [
  { value: 'all', ar: 'كل الظواهر والتصنيفات', en: 'All weather phenomena and classifications' },
  { value: 'hazards', ar: 'أي مخاطر مرصودة', en: 'Any detected hazard' },
  { value: 'rain', ar: 'أمطار / رذاذ / زخات', en: 'Rain / drizzle / showers' },
  { value: 'heavy_rain', ar: 'أمطار غزيرة', en: 'Heavy rain' },
  { value: 'thunderstorm', ar: 'عواصف رعدية / برد', en: 'Thunderstorms / hail' },
  { value: 'fog', ar: 'ضباب / ضباب متجمد', en: 'Fog / freezing fog' },
  { value: 'snow', ar: 'ثلوج / زخات ثلجية', en: 'Snow / snow showers' },
  { value: 'drizzle', ar: 'رذاذ مطري', en: 'Drizzle' },
  { value: 'freezing_rain', ar: 'أمطار متجمدة', en: 'Freezing rain' },
  { value: 'clear', ar: 'سماء صافية أو قليلة السحب', en: 'Clear / mainly clear sky' },
  { value: 'overcast', ar: 'سماء غائمة / غطاء سحابي كثيف', en: 'Overcast / dense cloud cover' },
  { value: 'strong_wind', ar: 'رياح قوية حسب عتبة النظام', en: 'Strong wind at system threshold' },
  { value: 'heat', ar: 'حرارة مرتفعة حسب عتبة النظام', en: 'High heat at system threshold' },
  { value: 'cold', ar: 'برودة شديدة حسب عتبة النظام', en: 'Cold at system threshold' },
  { value: 'cloud_high', ar: 'غطاء سحابي مرتفع (75% فأكثر)', en: 'High cloud cover (75% or more)' },
  { value: 'cloud_low', ar: 'غطاء سحابي منخفض (25% أو أقل)', en: 'Low cloud cover (25% or less)' },
  { value: 'humidity_high', ar: 'رطوبة مرتفعة (80% فأكثر)', en: 'High humidity (80% or more)' },
  { value: 'humidity_low', ar: 'رطوبة منخفضة (30% أو أقل)', en: 'Low humidity (30% or less)' },
  { value: 'rain_probability_high', ar: 'احتمالية أمطار مرتفعة (50% فأكثر)', en: 'High rain probability (50% or more)' },
  { value: 'rain_probability_low', ar: 'احتمالية أمطار منخفضة (20% أو أقل)', en: 'Low rain probability (20% or less)' },
  { value: 'dust_alert', ar: 'غبار مرتفع حسب عتبة النظام', en: 'High dust at system threshold' },
  { value: 'pm25_alert', ar: 'تلوث PM2.5 مرتفع حسب عتبة النظام', en: 'High PM2.5 at system threshold' },
  { value: 'waves_alert', ar: 'أمواج عالية حسب عتبة النظام', en: 'High waves at system threshold' },
  { value: 'flood_alert', ar: 'تصريف نهري مرتفع / خطر سيول', en: 'High river discharge / flood risk' },
  { value: 'anomaly:any:high', ar: 'أي متغير أعلى من المعتاد (P75 فأعلى)', en: 'Any metric above normal (P75+)' },
  { value: 'anomaly:any:extreme_high', ar: 'أي متغير مرتفع بشدة (أعلى من P90)', en: 'Any metric extremely high (above P90)' },
  { value: 'anomaly:any:low', ar: 'أي متغير أقل من المعتاد (أقل من P25)', en: 'Any metric below normal (below P25)' },
  { value: 'anomaly:any:extreme_low', ar: 'أي متغير منخفض بشدة (أقل من P10)', en: 'Any metric extremely low (below P10)' },
  { value: 'anomaly:any:normal', ar: 'متغير واحد على الأقل ضمن النطاق المعتاد', en: 'At least one metric in the normal range' },
  { value: 'anomaly:any:no_data', ar: 'متغير واحد على الأقل بلا قيمة توقع متاحة', en: 'At least one metric with no available forecast value' },
  { value: 'anomaly:any:insufficient_data', ar: 'متغير واحد على الأقل ببيانات تاريخية غير كافية', en: 'At least one metric with insufficient historical data' },
];

const ANOMALY_CATEGORIES = [
  { key: 'high', ar: 'مرتفع عن المعتاد (P75–P90)', en: 'Above normal (P75–P90)' },
  { key: 'extreme_high', ar: 'مرتفع بشدة (أعلى من P90)', en: 'Extremely high (above P90)' },
  { key: 'low', ar: 'منخفض عن المعتاد (P10–P25)', en: 'Below normal (P10–P25)' },
  { key: 'extreme_low', ar: 'منخفض بشدة (أقل من P10)', en: 'Extremely low (below P10)' },
  { key: 'normal', ar: 'ضمن النطاق المعتاد (P25–P75)', en: 'Normal range (P25–P75)' },
  { key: 'no_data', ar: 'لا توجد قيمة متاحة لهذا المؤشر', en: 'No forecast value available' },
  { key: 'insufficient_data', ar: 'بيانات تاريخية غير كافية', en: 'Insufficient historical data' },
];

export const WEATHER_FILTER_OPTIONS = [
  ...BASE_WEATHER_FILTER_OPTIONS,
  ...WEATHER_METRIC_FILTERS.flatMap((metric) =>
    ANOMALY_CATEGORIES.map((category) => ({
      value: `metric:${metric.key}:${category.key}`,
      ar: `تصنيف ${metric.ar}: ${category.ar}`,
      en: `${metric.en}: ${category.en}`,
    }))
  ),
];

const getExtraWeatherValue = (forecast, group, key, alias) => {
  const extra = forecast?.raw_json?.extra || {};
  const candidates = [
    extra?.[group]?.[key],
    extra?.air_quality?.[key],
    extra?.[group === 'air' ? 'air_quality' : group]?.[key],
    alias ? forecast?.raw_json?.extra?.[alias]?.[key] : null,
  ];
  for (const candidate of candidates) {
    const parsed = toWeatherNumber(candidate);
    if (parsed !== null) return parsed;
  }
  return null;
};

export function getWeatherMetricValue(assessment, metricKey) {
  const forecast = assessment?.forecast && typeof assessment.forecast === 'object'
    ? assessment.forecast
    : {};
  switch (metricKey) {
    case 'tmax': return toWeatherNumber(forecast.tmax);
    case 'tmin': return toWeatherNumber(forecast.tmin);
    case 'precip': return toWeatherNumber(forecast.precip_mm ?? forecast.precip);
    case 'wind': return toWeatherNumber(forecast.wind_max_kph ?? forecast.wind);
    case 'gusts': return toWeatherNumber(forecast.wind_gusts_kph ?? forecast.gusts);
    case 'humidity': return toWeatherNumber(forecast.humidity_mean_pct ?? forecast.humidity);
    case 'cloud': return toWeatherNumber(forecast.cloud_cover_mean_pct ?? forecast.cloud);
    case 'dust': return getExtraWeatherValue(forecast, 'air', 'dust_max');
    case 'pm25': return getExtraWeatherValue(forecast, 'air', 'pm25_max');
    case 'wave': return getExtraWeatherValue(forecast, 'marine', 'wave_height_max');
    case 'flood': return getExtraWeatherValue(forecast, 'flood', 'river_discharge_max');
    case 'precip_probability': return toWeatherNumber(forecast.precip_prob_pct);
    default: return null;
  }
}

function getMetricStatistics(assessment, metricKey) {
  if (!Array.isArray(assessment?.statistics)) return null;
  return assessment.statistics.find((item) => String(item?.metric ?? '') === metricKey) || null;
}

export function getWeatherMetricClass(assessment, metricKey, minSamples = 20) {
  const value = getWeatherMetricValue(assessment, metricKey);
  const statistic = getMetricStatistics(assessment, metricKey);
  const storedAnomaly = assessment?.anomalies?.[metricKey];
  const storedCategory = typeof storedAnomaly === 'string'
    ? storedAnomaly
    : String(storedAnomaly?.category || storedAnomaly?.class || '');

  if (value === null) return 'no_data';
  if (!statistic) {
    // A server-side "normal" may mean "low values are neutral" for high-only metrics;
    // without percentiles we must not mislabel that as a true normal/low classification.
    return ['high', 'extreme_high', 'low', 'extreme_low'].includes(storedCategory)
      ? storedCategory
      : 'insufficient_data';
  }
  const sampleCount = toWeatherNumber(statistic.sample_count);
  const p10 = toWeatherNumber(statistic.p10);
  const p25 = toWeatherNumber(statistic.p25);
  const p75 = toWeatherNumber(statistic.p75);
  const p90 = toWeatherNumber(statistic.p90);
  if (sampleCount === null || sampleCount < minSamples || [p10, p25, p75, p90].some((item) => item === null)) {
    return 'insufficient_data';
  }

  // Do not use the runner's high-only shortcut here: the UI needs to expose low
  // classifications too, including for wind, rain, humidity and the extra layers.
  if (value < p10) return 'extreme_low';
  if (value < p25) return 'low';
  if (value <= p75) return 'normal';
  if (value <= p90) return 'high';
  return 'extreme_high';
}

const DEFAULT_RAIN_CODES = [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99];
const DEFAULT_THUNDERSTORM_CODES = [95, 96, 99];
const DEFAULT_FOG_CODES = [45, 48];
const SNOW_CODES = [71, 73, 75, 77, 85, 86];

function parseConfiguredCodes(config, key, fallback) {
  const raw = config?.[key]?.value;
  if (typeof raw !== 'string' || !raw.trim()) return fallback;
  const values = raw.split(',').map((value) => Number(value.trim())).filter(Number.isInteger);
  return values.length ? values : fallback;
}

export function matchesWeatherPhenomenon(assessment, selectedFilter = 'all', intelConfig = {}, minSamples = 20) {
  if (selectedFilter === 'all') return true;
  if (!assessment || typeof assessment !== 'object' || Array.isArray(assessment)) return false;

  const forecast = assessment.forecast && typeof assessment.forecast === 'object'
    ? assessment.forecast
    : {};
  const weatherCode = toWeatherNumber(forecast.weather_code);
  const rainMm = getWeatherMetricValue(assessment, 'precip');
  const rainChance = getWeatherMetricValue(assessment, 'precip_probability');
  const maxTemp = getWeatherMetricValue(assessment, 'tmax');
  const minTemp = getWeatherMetricValue(assessment, 'tmin');
  const maxWind = getWeatherMetricValue(assessment, 'wind');
  const gusts = getWeatherMetricValue(assessment, 'gusts');
  const humidity = getWeatherMetricValue(assessment, 'humidity');
  const cloud = getWeatherMetricValue(assessment, 'cloud');
  const extraHazards = Array.isArray(assessment.hazards) ? assessment.hazards : [];
  const hazardCodes = new Set(
    extraHazards.filter((item) => item && typeof item === 'object')
      .map((item) => String(item.code ?? '').trim().toLowerCase()).filter(Boolean)
  );
  const hasHazard = (...codes) => codes.some((code) => hazardCodes.has(code));
  const rainCodes = parseConfiguredCodes(intelConfig, 'hazard.rain_codes', DEFAULT_RAIN_CODES);
  const thunderstormCodes = parseConfiguredCodes(intelConfig, 'hazard.thunderstorm_codes', DEFAULT_THUNDERSTORM_CODES);
  const fogCodes = parseConfiguredCodes(intelConfig, 'hazard.fog_codes', DEFAULT_FOG_CODES);

  if (selectedFilter.startsWith('metric:')) {
    const [, metricKey, category] = selectedFilter.split(':');
    if (!WEATHER_METRIC_FILTERS.some((metric) => metric.key === metricKey) ||
        !ANOMALY_CATEGORIES.some((item) => item.key === category)) return false;
    return getWeatherMetricClass(assessment, metricKey, minSamples) === category;
  }

  if (selectedFilter.startsWith('anomaly:any:')) {
    const category = selectedFilter.slice('anomaly:any:'.length);
    const categoriesByMetric = WEATHER_METRIC_FILTERS.map((metric) =>
      getWeatherMetricClass(assessment, metric.key, minSamples)
    );
    if (category === 'high') return categoriesByMetric.some((value) => value === 'high' || value === 'extreme_high');
    if (category === 'low') return categoriesByMetric.some((value) => value === 'low' || value === 'extreme_low');
    if (category === 'extreme_high') return categoriesByMetric.includes('extreme_high');
    if (category === 'extreme_low') return categoriesByMetric.includes('extreme_low');
    if (category === 'normal') return categoriesByMetric.includes('normal');
    if (category === 'no_data') return categoriesByMetric.includes('no_data');
    if (category === 'insufficient_data') return categoriesByMetric.includes('insufficient_data');
    return false;
  }

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
      return hasHazard('extreme_heat', 'heat') || hasThreshold(maxTemp, intelConfig, 'hazard.tmax_high_c', 40);
    case 'cold':
      return hasHazard('cold') ||
        (minTemp !== null && minTemp <= (toWeatherNumber(intelConfig?.['hazard.tmin_low_c']?.value) ?? 5));
    case 'fog':
      return hasHazard('fog') || fogCodes.includes(weatherCode);
    case 'snow':
      return SNOW_CODES.includes(weatherCode);
    case 'drizzle':
      return [51, 53, 55, 56, 57].includes(weatherCode);
    case 'freezing_rain':
      return [66, 67].includes(weatherCode);
    case 'clear':
      return [0, 1].includes(weatherCode);
    case 'overcast':
      return weatherCode === 3 || (cloud !== null && cloud >= 75);
    case 'cloud_high':
      return cloud !== null && cloud >= 75;
    case 'cloud_low':
      return cloud !== null && cloud <= 25;
    case 'humidity_high':
      return humidity !== null && humidity >= 80;
    case 'humidity_low':
      return humidity !== null && humidity <= 30;
    case 'rain_probability_high':
      return rainChance !== null && rainChance >= 50;
    case 'rain_probability_low':
      return rainChance !== null && rainChance <= 20;
    case 'dust_alert':
      return hasHazard('dust') || hasThreshold(getWeatherMetricValue(assessment, 'dust'), intelConfig, 'hazard.dust_high_ugm3', 80);
    case 'pm25_alert':
      return hasHazard('pm25') || hasThreshold(getWeatherMetricValue(assessment, 'pm25'), intelConfig, 'hazard.pm25_high_ugm3', 55);
    case 'waves_alert':
      return hasHazard('high_waves') || hasThreshold(getWeatherMetricValue(assessment, 'wave'), intelConfig, 'hazard.wave_high_m', 2.5);
    case 'flood_alert':
      return hasHazard('flood_risk') || hasThreshold(getWeatherMetricValue(assessment, 'flood'), intelConfig, 'hazard.flood_discharge_m3s', 400);
    case 'hazards':
      return extraHazards.length > 0;
    default:
      // Unknown filter values must never silently match every location.
      return false;
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

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getWeatherMetricClass,
  getWeatherMetricValue,
  matchesWeatherPhenomenon,
  shouldPreserveWeatherSnapshot,
  WEATHER_FILTER_OPTIONS,
  WEATHER_METRIC_FILTERS,
} from '../weatherIntelFilters.js';

const makeAssessment = ({
  forecast = {},
  hazards = [],
  statistics = [],
  anomalies = {},
} = {}) => ({
  forecast: { raw_json: { extra: {} }, ...forecast },
  hazards,
  statistics,
  anomalies,
});

const statistic = (metric, overrides = {}) => ({
  metric,
  sample_count: 30,
  p10: 10,
  p25: 25,
  p75: 75,
  p90: 90,
  ...overrides,
});

const setMetricValue = (metric, value, extra = {}) => {
  const forecast = { raw_json: { extra } };
  const fields = {
    tmax: 'tmax',
    tmin: 'tmin',
    precip: 'precip_mm',
    wind: 'wind_max_kph',
    gusts: 'wind_gusts_kph',
    humidity: 'humidity_mean_pct',
    cloud: 'cloud_cover_mean_pct',
  };
  if (fields[metric]) forecast[fields[metric]] = value;
  if (metric === 'dust' || metric === 'pm25') {
    forecast.raw_json.extra.air = {
      ...(extra.air || {}),
      [metric === 'dust' ? 'dust_max' : 'pm25_max']: value,
    };
  }
  if (metric === 'wave') {
    forecast.raw_json.extra.marine = { ...(extra.marine || {}), wave_height_max: value };
  }
  if (metric === 'flood') {
    forecast.raw_json.extra.flood = { ...(extra.flood || {}), river_discharge_max: value };
  }
  return forecast;
};

test('فلتر الكل يعرض البيانات، وأي قيمة فلتر غير معروفة لا تطابق المحافظات', () => {
  assert.equal(matchesWeatherPhenomenon(makeAssessment(), 'all'), true);
  assert.equal(matchesWeatherPhenomenon(null, 'all'), true);
  assert.equal(matchesWeatherPhenomenon(makeAssessment(), 'not-a-real-filter'), false);
});

test('القائمة تعرض فلترًا لكل تصنيف ولكل مؤشر قابل للتحليل', () => {
  const values = new Set(WEATHER_FILTER_OPTIONS.map((option) => option.value));
  assert.ok(values.has('fog'));
  assert.ok(values.has('cloud_high'));
  assert.ok(values.has('cloud_low'));
  assert.ok(values.has('rain_probability_high'));
  assert.ok(values.has('rain_probability_low'));
  assert.ok(values.has('strong_wind'));
  for (const metric of WEATHER_METRIC_FILTERS) {
    for (const category of ['high', 'extreme_high', 'low', 'extreme_low', 'normal', 'no_data', 'insufficient_data']) {
      assert.ok(values.has(`metric:${metric.key}:${category}`), `missing ${metric.key} / ${category}`);
    }
  }
});

test('أكواد WMO تفصل المطر والرذاذ والمطر المتجمد والرعد والضباب والثلج والصفاء', () => {
  assert.equal(matchesWeatherPhenomenon(makeAssessment({ forecast: { weather_code: 61 } }), 'rain'), true);
  assert.equal(matchesWeatherPhenomenon(makeAssessment({ forecast: { weather_code: 65 } }), 'heavy_rain'), true);
  assert.equal(matchesWeatherPhenomenon(makeAssessment({ forecast: { weather_code: 53 } }), 'drizzle'), true);
  assert.equal(matchesWeatherPhenomenon(makeAssessment({ forecast: { weather_code: 66 } }), 'freezing_rain'), true);
  assert.equal(matchesWeatherPhenomenon(makeAssessment({ forecast: { weather_code: 95 } }), 'thunderstorm'), true);
  assert.equal(matchesWeatherPhenomenon(makeAssessment({ forecast: { weather_code: 48 } }), 'fog'), true);
  assert.equal(matchesWeatherPhenomenon(makeAssessment({ forecast: { weather_code: 85 } }), 'snow'), true);
  assert.equal(matchesWeatherPhenomenon(makeAssessment({ forecast: { weather_code: 0 } }), 'clear'), true);
  assert.equal(matchesWeatherPhenomenon(makeAssessment({ forecast: { weather_code: 3 } }), 'overcast'), true);
});

test('أكواد الضباب والرعد قابلة للقراءة من إعدادات النظام', () => {
  const config = {
    'hazard.fog_codes': { value: '45, 48, 50' },
    'hazard.thunderstorm_codes': { value: '95, 96, 99, 100' },
  };
  assert.equal(matchesWeatherPhenomenon(makeAssessment({ forecast: { weather_code: 50 } }), 'fog', config), true);
  assert.equal(matchesWeatherPhenomenon(makeAssessment({ forecast: { weather_code: 100 } }), 'thunderstorm', config), true);
});

test('فلتر المطر يعتمد على كمية الهطول والاحتمالية والأكواد، دون اعتبار الصفر مطرًا', () => {
  assert.equal(matchesWeatherPhenomenon(makeAssessment({ forecast: { precip_mm: 1 } }), 'rain'), true);
  assert.equal(matchesWeatherPhenomenon(makeAssessment({ forecast: { precip_prob_pct: 15 } }), 'rain'), true);
  assert.equal(matchesWeatherPhenomenon(makeAssessment({ forecast: { weather_code: 61 } }), 'rain'), true);
  assert.equal(matchesWeatherPhenomenon(makeAssessment({ forecast: { precip_mm: 0, precip_prob_pct: 0, weather_code: 0 } }), 'rain'), false);
  assert.equal(matchesWeatherPhenomenon(makeAssessment({ forecast: { precip_mm: 12 } }), 'heavy_rain', { 'hazard.precip_heavy_mm': { value: '12' } }), true);
});

test('فلتر الغطاء السحابي والرطوبة واحتمالية المطر يعمل في الاتجاهين', () => {
  assert.equal(matchesWeatherPhenomenon(makeAssessment({ forecast: { cloud_cover_mean_pct: 80 } }), 'cloud_high'), true);
  assert.equal(matchesWeatherPhenomenon(makeAssessment({ forecast: { cloud_cover_mean_pct: 20 } }), 'cloud_low'), true);
  assert.equal(matchesWeatherPhenomenon(makeAssessment({ forecast: { cloud_cover_mean_pct: 50 } }), 'cloud_high'), false);
  assert.equal(matchesWeatherPhenomenon(makeAssessment({ forecast: { humidity_mean_pct: 90 } }), 'humidity_high'), true);
  assert.equal(matchesWeatherPhenomenon(makeAssessment({ forecast: { humidity_mean_pct: 20 } }), 'humidity_low'), true);
  assert.equal(matchesWeatherPhenomenon(makeAssessment({ forecast: { precip_prob_pct: 70 } }), 'rain_probability_high'), true);
  assert.equal(matchesWeatherPhenomenon(makeAssessment({ forecast: { precip_prob_pct: 10 } }), 'rain_probability_low'), true);
  assert.equal(matchesWeatherPhenomenon(makeAssessment({ forecast: { precip_prob_pct: null } }), 'rain_probability_low'), false);
});

test('حدود الرياح والحرارة تستخدم إعدادات النظام والقيم الافتراضية', () => {
  const config = {
    'hazard.wind_high_kph': { value: '45' },
    'hazard.wind_gusts_high_kph': { value: '65' },
    'hazard.tmax_high_c': { value: '42' },
    'hazard.tmin_low_c': { value: '4' },
  };
  assert.equal(matchesWeatherPhenomenon(makeAssessment({ forecast: { wind_max_kph: 45 } }), 'strong_wind', config), true);
  assert.equal(matchesWeatherPhenomenon(makeAssessment({ forecast: { wind_gusts_kph: 65 } }), 'strong_wind', config), true);
  assert.equal(matchesWeatherPhenomenon(makeAssessment({ forecast: { tmax: 42 } }), 'heat', config), true);
  assert.equal(matchesWeatherPhenomenon(makeAssessment({ forecast: { tmax: 41 } }), 'heat', config), false);
  assert.equal(matchesWeatherPhenomenon(makeAssessment({ forecast: { tmin: 4 } }), 'cold', config), true);
  assert.equal(matchesWeatherPhenomenon(makeAssessment({ forecast: { tmin: 5 } }), 'cold', config), false);
  assert.equal(matchesWeatherPhenomenon(makeAssessment({ hazards: [{ code: 'extreme_heat' }] }), 'heat'), true);
});

test('طبقات الغبار وPM2.5 والموج والسيول تُقرأ من snapshot raw_json.extra', () => {
  const assessment = makeAssessment({
    forecast: {
      raw_json: {
        extra: {
          air: { dust_max: 90, pm25_max: 60 },
          marine: { wave_height_max: 3 },
          flood: { river_discharge_max: 450 },
        },
      },
    },
  });
  assert.equal(getWeatherMetricValue(assessment, 'dust'), 90);
  assert.equal(getWeatherMetricValue(assessment, 'pm25'), 60);
  assert.equal(getWeatherMetricValue(assessment, 'wave'), 3);
  assert.equal(getWeatherMetricValue(assessment, 'flood'), 450);
  assert.equal(matchesWeatherPhenomenon(assessment, 'dust_alert'), true);
  assert.equal(matchesWeatherPhenomenon(assessment, 'pm25_alert'), true);
  assert.equal(matchesWeatherPhenomenon(assessment, 'waves_alert'), true);
  assert.equal(matchesWeatherPhenomenon(assessment, 'flood_alert'), true);
  assert.equal(matchesWeatherPhenomenon(makeAssessment({ forecast: { raw_json: { extra: {} } } }), 'dust_alert'), false);
});

test('طبقات إضافية تقرأ أيضًا اسم المصدر air_quality عند توفره', () => {
  const assessment = makeAssessment({
    forecast: { raw_json: { extra: { air_quality: { dust_max: 81 } } } },
  });
  assert.equal(getWeatherMetricValue(assessment, 'dust'), 81);
  assert.equal(matchesWeatherPhenomenon(assessment, 'dust_alert'), true);
});

test('كل مؤشر يدعم الفئات الست، بما فيها القيم المنخفضة للمقاييس التي يصنفها المحرك High-only', () => {
  const cases = [
    { value: 5, category: 'extreme_low' },
    { value: 20, category: 'low' },
    { value: 50, category: 'normal' },
    { value: 80, category: 'high' },
    { value: 95, category: 'extreme_high' },
  ];
  for (const metric of WEATHER_METRIC_FILTERS) {
    for (const scenario of cases) {
      const assessment = makeAssessment({
        forecast: setMetricValue(metric.key, scenario.value),
        statistics: [statistic(metric.key)],
        // Mimic the backend's high-only shortcut; frontend percentiles must still detect lows.
        anomalies: { [metric.key]: { category: scenario.value < 75 ? 'normal' : scenario.category } },
      });
      assert.equal(getWeatherMetricValue(assessment, metric.key), scenario.value, `value mapping: ${metric.key}`);
      assert.equal(getWeatherMetricClass(assessment, metric.key), scenario.category, `class: ${metric.key} / ${scenario.category}`);
      assert.equal(
        matchesWeatherPhenomenon(assessment, `metric:${metric.key}:${scenario.category}`),
        true,
        `filter: ${metric.key} / ${scenario.category}`,
      );
    }
    const insufficient = makeAssessment({
      forecast: setMetricValue(metric.key, 50),
      statistics: [statistic(metric.key, { sample_count: 19 })],
      anomalies: { [metric.key]: { category: 'insufficient_data' } },
    });
    assert.equal(getWeatherMetricClass(insufficient, metric.key), 'insufficient_data');
    assert.equal(matchesWeatherPhenomenon(insufficient, `metric:${metric.key}:insufficient_data`), true);
  }
});

test('الحدود التاريخية تصنف P10 وP25 وP75 وP90 بنفس ترتيب محرك الطقس', () => {
  const at = (value) => makeAssessment({
    forecast: setMetricValue('wind', value),
    statistics: [statistic('wind')],
  });
  assert.equal(getWeatherMetricClass(at(9.99), 'wind'), 'extreme_low');
  assert.equal(getWeatherMetricClass(at(10), 'wind'), 'low');
  assert.equal(getWeatherMetricClass(at(24.99), 'wind'), 'low');
  assert.equal(getWeatherMetricClass(at(25), 'wind'), 'normal');
  assert.equal(getWeatherMetricClass(at(75), 'wind'), 'normal');
  assert.equal(getWeatherMetricClass(at(75.01), 'wind'), 'high');
  assert.equal(getWeatherMetricClass(at(90), 'wind'), 'high');
  assert.equal(getWeatherMetricClass(at(90.01), 'wind'), 'extreme_high');
});

test('فلتر الاتجاه العام يعمل حتى عندما يخبئ تصنيف المحرك انخفاضًا تاريخيًا', () => {
  const assessment = makeAssessment({
    forecast: setMetricValue('wind', 15),
    statistics: [statistic('wind')],
    anomalies: { wind: { category: 'normal', reason: 'low is neutral in the runner' } },
  });
  assert.equal(matchesWeatherPhenomenon(assessment, 'metric:wind:low'), true);
  assert.equal(matchesWeatherPhenomenon(assessment, 'anomaly:any:low'), true);
  assert.equal(matchesWeatherPhenomenon(assessment, 'anomaly:any:high'), false);
});

test('التصنيف العام يعرض المحافظات التي لديها ارتفاع أو انخفاض أو بيانات تاريخية ناقصة', () => {
  const high = makeAssessment({ forecast: setMetricValue('tmax', 95), statistics: [statistic('tmax')] });
  const low = makeAssessment({ forecast: setMetricValue('cloud', 5), statistics: [statistic('cloud')] });
  const insufficient = makeAssessment({ forecast: setMetricValue('dust', 30), statistics: [statistic('dust', { sample_count: 3 })] });
  assert.equal(matchesWeatherPhenomenon(high, 'anomaly:any:extreme_high'), true);
  assert.equal(matchesWeatherPhenomenon(low, 'anomaly:any:extreme_low'), true);
  assert.equal(matchesWeatherPhenomenon(insufficient, 'anomaly:any:insufficient_data'), true);
});

test('فلتر المخاطر يطابق الإنذارات الفعلية فقط', () => {
  assert.equal(matchesWeatherPhenomenon(makeAssessment({ hazards: [{ code: 'fog' }] }), 'hazards'), true);
  assert.equal(matchesWeatherPhenomenon(makeAssessment({ hazards: [] }), 'hazards'), false);
});

test('الاستجابة الفارغة في التحديث الصامت تحفظ بيانات النطاق نفسه فقط', () => {
  const common = {
    silent: true,
    nextCount: 0,
    previousCount: 9,
    previousScopeKey: '2026-10-20|all',
    requestScopeKey: '2026-10-20|all',
  };
  assert.equal(shouldPreserveWeatherSnapshot(common), true);
  assert.equal(shouldPreserveWeatherSnapshot({ ...common, requestScopeKey: '2026-10-21|all' }), false);
  assert.equal(shouldPreserveWeatherSnapshot({ ...common, silent: false }), false);
  assert.equal(shouldPreserveWeatherSnapshot({ ...common, previousCount: 0 }), false);
  assert.equal(shouldPreserveWeatherSnapshot({ ...common, nextCount: 1 }), false);
});


test('غياب قيمة التوقع منفصل عن نقص التاريخ ولا يُصنّف على أنه طبيعي', () => {
  const noForecast = makeAssessment({ forecast: setMetricValue('dust', null) });
  assert.equal(getWeatherMetricClass(noForecast, 'dust'), 'no_data');
  assert.equal(matchesWeatherPhenomenon(noForecast, 'metric:dust:no_data'), true);
  assert.equal(matchesWeatherPhenomenon(noForecast, 'metric:dust:insufficient_data'), false);
  assert.equal(matchesWeatherPhenomenon(noForecast, 'anomaly:any:no_data'), true);

  const weakHistory = makeAssessment({
    forecast: setMetricValue('dust', 35),
    statistics: [statistic('dust', { sample_count: 8 })],
  });
  assert.equal(getWeatherMetricClass(weakHistory, 'dust'), 'insufficient_data');
  assert.equal(matchesWeatherPhenomenon(weakHistory, 'metric:dust:insufficient_data'), true);
  assert.equal(matchesWeatherPhenomenon(weakHistory, 'metric:dust:no_data'), false);
});

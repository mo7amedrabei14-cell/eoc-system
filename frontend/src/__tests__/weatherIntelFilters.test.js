import test from 'node:test';
import assert from 'node:assert/strict';

import {
  matchesWeatherPhenomenon,
  shouldPreserveWeatherSnapshot,
} from '../weatherIntelFilters.js';

const assessment = ({ forecast = {}, hazards = [] } = {}) => ({
  forecast,
  hazards,
});

test('فلتر الكل لا يستبعد أي محافظة حتى لو التوقع غير متاح', () => {
  assert.equal(matchesWeatherPhenomenon(assessment(), 'all'), true);
  assert.equal(matchesWeatherPhenomenon(null, 'all'), true);
});

test('فلتر الأمطار يطابق كمية الهطول أو احتماليته أو أكواد WMO الممطرة', () => {
  assert.equal(matchesWeatherPhenomenon(assessment({ forecast: { precip_mm: 1 } }), 'rain'), true);
  assert.equal(matchesWeatherPhenomenon(assessment({ forecast: { precip_prob_pct: 15 } }), 'rain'), true);
  assert.equal(matchesWeatherPhenomenon(assessment({ forecast: { weather_code: 61 } }), 'rain'), true);
  assert.equal(matchesWeatherPhenomenon(assessment({ forecast: { precip_mm: 0, precip_prob_pct: 0, weather_code: 0 } }), 'rain'), false);
});

test('فلتر الأمطار الغزيرة يحترم عتبة الخادم وأكواد المطر الغزير', () => {
  const config = { 'hazard.precip_heavy_mm': { value: '12' } };
  assert.equal(matchesWeatherPhenomenon(assessment({ forecast: { precip_mm: 12 } }), 'heavy_rain', config), true);
  assert.equal(matchesWeatherPhenomenon(assessment({ forecast: { precip_mm: 10 } }), 'heavy_rain', config), false);
  assert.equal(matchesWeatherPhenomenon(assessment({ forecast: { weather_code: 65 } }), 'heavy_rain'), true);
  assert.equal(matchesWeatherPhenomenon(assessment({ hazards: [{ code: 'heavy_rain' }] }), 'heavy_rain'), true);
});

test('فلتر العواصف الرعدية يطابق كود WMO أو تحذير العاصفة', () => {
  assert.equal(matchesWeatherPhenomenon(assessment({ forecast: { weather_code: 95 } }), 'thunderstorm'), true);
  assert.equal(matchesWeatherPhenomenon(assessment({ hazards: [{ code: 'thunderstorm' }] }), 'thunderstorm'), true);
  assert.equal(matchesWeatherPhenomenon(assessment({ forecast: { weather_code: 3 } }), 'thunderstorm'), false);
});

test('فلتر الرياح يستخدم عتبات الرياح والهبات المضبوطة', () => {
  const config = {
    'hazard.wind_high_kph': { value: '45' },
    'hazard.wind_gusts_high_kph': { value: '65' },
  };
  assert.equal(matchesWeatherPhenomenon(assessment({ forecast: { wind_max_kph: 45 } }), 'strong_wind', config), true);
  assert.equal(matchesWeatherPhenomenon(assessment({ forecast: { wind_gusts_kph: 65 } }), 'strong_wind', config), true);
  assert.equal(matchesWeatherPhenomenon(assessment({ forecast: { wind_max_kph: 44, wind_gusts_kph: 64 } }), 'strong_wind', config), false);
});

test('فلتر الحرارة والبرودة يستخدمان عتبات الخادم مع حدود افتراضية آمنة', () => {
  assert.equal(matchesWeatherPhenomenon(assessment({ forecast: { tmax: 41 } }), 'heat'), true);
  assert.equal(matchesWeatherPhenomenon(assessment({ forecast: { tmax: 39 } }), 'heat'), false);
  const config = { 'hazard.tmin_low_c': { value: '3' } };
  assert.equal(matchesWeatherPhenomenon(assessment({ forecast: { tmin: 3 } }), 'cold', config), true);
  assert.equal(matchesWeatherPhenomenon(assessment({ forecast: { tmin: 4 } }), 'cold', config), false);
});

test('فلتر الضباب والمخاطر المكتشفة لا يطابقان السجلات النظيفة', () => {
  assert.equal(matchesWeatherPhenomenon(assessment({ forecast: { weather_code: 45 } }), 'fog'), true);
  assert.equal(matchesWeatherPhenomenon(assessment({ hazards: [{ code: 'fog' }] }), 'fog'), true);
  assert.equal(matchesWeatherPhenomenon(assessment({ hazards: [] }), 'hazards'), false);
  assert.equal(matchesWeatherPhenomenon(assessment({ hazards: [{ code: 'heat' }] }), 'hazards'), true);
  assert.equal(matchesWeatherPhenomenon(assessment(), 'unknown-filter'), true);
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

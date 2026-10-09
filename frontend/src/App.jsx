import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import Login from './Login';
import Dashboard, { WorkingToast } from './Dashboard';
import { installWorkingAuto } from './workingToast';
import CustomTooltipLayer from './components/CustomTooltipLayer';

// ⛑️ حبة العمل العامة — مركّبة على مستوى التطبيق كله (تشمل شاشة الدخول وأي صفحة)
//    أي fetch في النظام (تحميل بيانات أو ضغطة زر) يُظهرها حتى ينتهي.
installWorkingAuto();

function App() {
  return (
    <BrowserRouter>
      <MotionConfig reducedMotion="user">
        <WorkingToast />
        <CustomTooltipLayer />
        <Routes>
          {/* المسار الأساسي بيودي على صفحة الدخول */}
          <Route path="/" element={<Login />} />
          
          {/* مسار لوحة التحكم */}
          <Route path="/dashboard" element={<Dashboard />} />
          
          {/* لو اليوزر كتب أي رابط غلط، يرجعه لصفحة الدخول */}
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </MotionConfig>
    </BrowserRouter>
  );
}

export default App;

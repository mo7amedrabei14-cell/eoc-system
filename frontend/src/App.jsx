import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './Login';
import Dashboard, { WorkingToast } from './Dashboard';
import { installWorkingAuto } from './workingToast';

// ⛑️ حبة العمل العامة — مركّبة على مستوى التطبيق كله (تشمل شاشة الدخول وأي صفحة)
//    أي fetch في النظام (تحميل بيانات أو ضغطة زر) يُظهرها حتى ينتهي.
installWorkingAuto();

function App() {
  return (
    <BrowserRouter>
      <WorkingToast />
      <Routes>
        {/* المسار الأساسي بيودي على صفحة الدخول */}
        <Route path="/" element={<Login />} />
        
        {/* مسار لوحة التحكم */}
        <Route path="/dashboard" element={<Dashboard />} />
        
        {/* لو اليوزر كتب أي رابط غلط، يرجعه لصفحة الدخول */}
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;

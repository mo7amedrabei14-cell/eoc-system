import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './Login';
import Dashboard from './Dashboard';

function App() {
  return (
    <BrowserRouter>
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
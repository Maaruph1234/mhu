import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { WalletProvider } from "./context/WalletContext";
import { ProtectedRoute } from "./routes/ProtectedRoute";
import { DashboardLayout } from "./components/layout/DashboardLayout";
import { SplashScreen } from "./components/ui/SplashScreen";

import Landing from "./pages/marketing/Landing";
import Login from "./pages/auth/Login";
import Register from "./pages/auth/Register";
import VerifyOtp from "./pages/auth/VerifyOtp";
import ForgotPassword from "./pages/auth/ForgotPassword";

import Dashboard from "./pages/dashboard/Dashboard";
import FundWallet from "./pages/dashboard/FundWallet";
import VirtualCard from "./pages/dashboard/VirtualCard";
import Esim from "./pages/dashboard/Esim";
import FlightBooking from "./pages/dashboard/FlightBooking";
import Transfer from "./pages/dashboard/Transfer";
import Airtime from "./pages/dashboard/Airtime";
import Data from "./pages/dashboard/Data";
import Tv from "./pages/dashboard/Tv";
import Electricity from "./pages/dashboard/Electricity";
import ExamPins from "./pages/dashboard/ExamPins";
import Transactions from "./pages/dashboard/Transactions";
import Referrals from "./pages/dashboard/Referrals";
import Profile from "./pages/dashboard/Profile";

function App() {
  return (
    <BrowserRouter>
      <SplashScreen />
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/verify-otp" element={<VerifyOtp />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />

          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <WalletProvider>
                  <DashboardLayout />
                </WalletProvider>
              </ProtectedRoute>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="fund" element={<FundWallet />} />
            <Route path="cards" element={<VirtualCard />} />
            <Route path="esim" element={<Esim />} />
            <Route path="flights" element={<FlightBooking />} />
            <Route path="transfer" element={<Transfer />} />
            <Route path="airtime" element={<Airtime />} />
            <Route path="data" element={<Data />} />
            <Route path="tv" element={<Tv />} />
            <Route path="electricity" element={<Electricity />} />
            <Route path="exam-pins" element={<ExamPins />} />
            <Route path="transactions" element={<Transactions />} />
            <Route path="referrals" element={<Referrals />} />
            <Route path="profile" element={<Profile />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;

import React, { useState } from 'react';
import { X, ShieldCheck, User, Lock, AlertCircle, ArrowRight, KeyRound, Mail, CheckCircle2 } from 'lucide-react';
import { AdminUser } from '../../types';

interface AdminLoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess: (user: AdminUser) => void;
}

type RecoveryStep = 'request' | 'verify' | 'reset' | 'done';

export const AdminLoginModal: React.FC<AdminLoginModalProps> = ({ isOpen, onClose, onLoginSuccess }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [recoveryOpen,setRecoveryOpen]=useState(false);
  const [recoveryStep,setRecoveryStep]=useState<RecoveryStep>('request');
  const [recoveryUsername,setRecoveryUsername]=useState('admin');
  const [maskedEmail,setMaskedEmail]=useState('');
  const [otp,setOtp]=useState('');
  const [resetToken,setResetToken]=useState('');
  const [newPassword,setNewPassword]=useState('');
  const [confirmPassword,setConfirmPassword]=useState('');
  const [recoveryBusy,setRecoveryBusy]=useState(false);
  const [recoveryMessage,setRecoveryMessage]=useState('');

  if (!isOpen) return null;

  const api = async (url:string, body:any) => {
    const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data?.error||'Request failed.');
    return data;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setIsLoggingIn(true);
    const cleanUser = username.trim().toLowerCase();
    const cleanPass = password.trim();
    try {
      const response = await fetch('/api/staff/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: cleanUser, password: cleanPass }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setErrorMsg(data?.error || 'Invalid username or password.'); return; }
      if (!data?.user) { setErrorMsg('Login response is invalid.'); return; }
      const matchedUser: AdminUser = { ...data.user, _sessionToken: data.token } as any;
      onLoginSuccess(matchedUser);
      return;
    } catch (serverError) {
      console.warn('Shared staff login API unavailable.', serverError);
      setErrorMsg('Login service is temporarily unavailable. Please try again.');
    } finally { setIsLoggingIn(false); }
  };

  const requestCode=async()=>{
    setRecoveryBusy(true);setRecoveryMessage('');
    try{const data=await api('/api/staff/super-admin-recovery/request',{username:recoveryUsername.trim().toLowerCase()||'admin'});setMaskedEmail(data.masked_email||'your recovery Gmail');setRecoveryStep('verify');setRecoveryMessage(`Verification code sent to ${data.masked_email||'the saved recovery email'}.`);}catch(error:any){setRecoveryMessage(error?.message||'Code could not be sent.');}finally{setRecoveryBusy(false);}
  };
  const verifyCode=async()=>{
    setRecoveryBusy(true);setRecoveryMessage('');
    try{const data=await api('/api/staff/super-admin-recovery/verify',{username:recoveryUsername.trim().toLowerCase()||'admin',otp:otp.trim()});setResetToken(data.reset_token||'');setRecoveryStep('reset');setRecoveryMessage('Code verified. Create a new Super Admin password.');}catch(error:any){setRecoveryMessage(error?.message||'Verification failed.');}finally{setRecoveryBusy(false);}
  };
  const resetPassword=async()=>{
    if(newPassword.length<8)return setRecoveryMessage('New password must be at least 8 characters.');
    if(newPassword!==confirmPassword)return setRecoveryMessage('New passwords do not match.');
    setRecoveryBusy(true);setRecoveryMessage('');
    try{await api('/api/staff/super-admin-recovery/reset',{reset_token:resetToken,new_password:newPassword});setRecoveryStep('done');setPassword('');setRecoveryMessage('Password reset complete. You can now sign in with the new password.');}catch(error:any){setRecoveryMessage(error?.message||'Password reset failed.');}finally{setRecoveryBusy(false);}
  };
  const closeRecovery=()=>{setRecoveryOpen(false);setRecoveryStep('request');setRecoveryMessage('');setOtp('');setResetToken('');setNewPassword('');setConfirmPassword('');};

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs overflow-y-auto">
      <div className="relative w-full max-w-md bg-white border border-gray-100 rounded-3xl shadow-2xl p-6 sm:p-8 space-y-6 text-gray-900 my-auto">
        <button onClick={onClose} className="absolute top-4 right-4 p-2 rounded-full bg-gray-100 text-gray-400 hover:text-black hover:bg-gray-200"><X className="w-5 h-5" /></button>
        <div className="text-center space-y-2"><div className="w-14 h-14 rounded-2xl bg-black text-white flex items-center justify-center mx-auto shadow-md"><ShieldCheck className="w-8 h-8 text-orange-500" /></div><div><h2 className="text-xl font-extrabold">Admin & Staff Login</h2><p className="text-xs text-gray-500 mt-0.5">Use your O-RA username and password.</p></div></div>

        {!recoveryOpen ? <>
          {errorMsg && <div className="bg-red-50 border border-red-200 rounded-2xl p-3 text-xs text-red-700 flex items-center space-x-2"><AlertCircle className="w-4 h-4 shrink-0 text-red-500" /><span>{errorMsg}</span></div>}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div><label className="block text-gray-700 font-bold mb-1 text-xs">Username *</label><div className="relative"><input type="text" required value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" className="w-full bg-gray-50 border border-gray-200 rounded-xl pl-9 pr-3 py-2.5 text-gray-900 font-medium focus:outline-none focus:border-orange-500" /><User className="w-4 h-4 text-gray-400 absolute left-3 top-3" /></div></div>
            <div><label className="block text-gray-700 font-bold mb-1 text-xs">Password *</label><div className="relative"><input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="w-full bg-gray-50 border border-gray-200 rounded-xl pl-9 pr-3 py-2.5 text-gray-900 font-medium focus:outline-none focus:border-orange-500" /><Lock className="w-4 h-4 text-gray-400 absolute left-3 top-3" /></div></div>
            <button type="button" onClick={()=>{setRecoveryUsername(username.trim().toLowerCase()||'admin');setRecoveryOpen(true);setRecoveryStep('request');setRecoveryMessage('');}} className="w-full text-center text-[11px] font-black text-orange-600 hover:underline">Forgot Super Admin Password?</button>
            <button type="submit" disabled={isLoggingIn} className="w-full py-3 rounded-full bg-black hover:bg-orange-600 disabled:opacity-60 text-white font-bold text-xs flex items-center justify-center space-x-2 transition-colors shadow-md"><span>{isLoggingIn ? 'Checking Account...' : 'Login to Control Center'}</span><ArrowRight className="w-4 h-4" /></button>
          </form>
        </> : <div className="space-y-4">
          <div className="rounded-2xl border border-orange-100 bg-orange-50 p-4"><div className="flex items-center gap-2 text-orange-700"><KeyRound className="h-4 w-4"/><p className="text-xs font-black">Super Admin Gmail Recovery</p></div><p className="mt-1 text-[10px] leading-5 text-gray-600">This recovery flow only resets a Super Admin account. Staff accounts remain managed by Super Admin.</p></div>
          {recoveryStep==='request'&&<div className="space-y-3"><label className="block text-xs font-bold text-gray-700">Super Admin Username<input value={recoveryUsername} onChange={(e)=>setRecoveryUsername(e.target.value)} className="mt-1 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5"/></label><button disabled={recoveryBusy} onClick={()=>void requestCode()} className="w-full rounded-xl bg-black py-3 text-xs font-black text-white disabled:opacity-50"><Mail className="mr-1 inline h-4 w-4"/>{recoveryBusy?'Sending...':'Send Gmail Verification Code'}</button></div>}
          {recoveryStep==='verify'&&<div className="space-y-3"><p className="text-[11px] text-gray-600">Enter the code sent to <b>{maskedEmail}</b>.</p><input inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={otp} onChange={(e)=>setOtp(e.target.value.replace(/\D/g,''))} placeholder="000000" className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-center font-mono text-xl font-black tracking-[0.3em]"/><button disabled={recoveryBusy||otp.length<6} onClick={()=>void verifyCode()} className="w-full rounded-xl bg-black py-3 text-xs font-black text-white disabled:opacity-50">{recoveryBusy?'Checking...':'Verify Code'}</button><button disabled={recoveryBusy} onClick={()=>void requestCode()} className="w-full text-[10px] font-black text-orange-600">Send another code</button></div>}
          {recoveryStep==='reset'&&<div className="space-y-3"><input type="password" value={newPassword} onChange={(e)=>setNewPassword(e.target.value)} placeholder="New password (8+ characters)" className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5"/><input type="password" value={confirmPassword} onChange={(e)=>setConfirmPassword(e.target.value)} placeholder="Confirm new password" className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5"/><button disabled={recoveryBusy} onClick={()=>void resetPassword()} className="w-full rounded-xl bg-black py-3 text-xs font-black text-white disabled:opacity-50">{recoveryBusy?'Resetting...':'Reset Super Admin Password'}</button></div>}
          {recoveryStep==='done'&&<div className="space-y-3 text-center"><CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600"/><p className="text-sm font-black text-gray-900">Password Reset Complete</p><button onClick={closeRecovery} className="w-full rounded-xl bg-black py-3 text-xs font-black text-white">Back to Login</button></div>}
          {recoveryMessage&&<div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-[10px] leading-5 text-gray-600">{recoveryMessage}</div>}
          {recoveryStep!=='done'&&<button onClick={closeRecovery} className="w-full text-[10px] font-black text-gray-500 hover:text-black">Back to normal login</button>}
        </div>}
      </div>
    </div>
  );
};

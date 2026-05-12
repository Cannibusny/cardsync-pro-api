import { useState } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useAuth } from '../auth.jsx';

export default function LoginPage() {
  const { user, login, loaded } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState(null);
  const { register, handleSubmit, formState: { isSubmitting } } = useForm();

  if (loaded && user) return <Navigate to={location.state?.from || '/'} replace />;

  const onSubmit = async (values) => {
    setError(null);
    try {
      await login(values.email, values.password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message || 'Sign-in failed');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-slate-100 p-4">
      <div className="card-pad w-full max-w-md">
        <div className="text-center mb-6">
          <div className="text-2xl font-bold text-primary-700">CardSync Pro</div>
          <div className="text-sm text-slate-500 mt-1">Electronic Valet — operator sign-in</div>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="label">Email</label>
            <input
              className="input"
              type="email"
              autoComplete="username"
              autoFocus
              {...register('email', { required: true })}
            />
          </div>
          <div>
            <label className="label">Password</label>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              {...register('password', { required: true })}
            />
          </div>
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          <button className="btn-primary w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <div className="mt-6 text-xs text-slate-400 text-center">
          v2.0 • TCG retail platform
        </div>
      </div>
    </div>
  );
}

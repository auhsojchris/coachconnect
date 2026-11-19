export type Role = 'admin' | 'coach' | 'client';

export interface SportCategory { id: string; name: string; description?: string; icon?: string; isActive?: boolean; }
export interface Specialization { id?: string; sportCategoryId: string; certification?: string; yearsExperience?: number; sportCategory?: SportCategory; }
export interface CoachProfile { id: string; userId?: string; bio?: string; experienceYears?: number; hourlyRate: number; location?: string; city?: string; country?: string; averageRating?: number; totalReviews?: number; isVerified?: boolean; gcashNumber?: string; gcashAccountName?: string; specializations?: Specialization[]; }
export interface User { id: string; name: string; email: string; phone?: string; role?: { name: Role }; profileImage?: string; coachProfile?: CoachProfile; clientProfile?: Record<string, unknown>; isActive?: boolean; emailVerified?: boolean; createdAt?: string; gcashNumber?: string; gcashAccountName?: string; }
export interface Coach { id: string; hourlyRate: number; bio?: string; city?: string; location?: string; country?: string; experienceYears?: number; averageRating?: number; totalReviews?: number; isVerified?: boolean; gcashNumber?: string; gcashAccountName?: string; user?: User; specializations?: Specialization[]; }
export interface TimeSlot { id: string; date: string; startTime: string; endTime: string; status: string; }
export interface Availability { id: string; coachId: string; isRecurring: boolean; dayOfWeek?: number | null; specificDate?: string | null; startTime: string; endTime: string; isActive?: boolean; }
export interface Payment { id: string; status: string; amount: number; currency?: string; provider?: string; gcashReference?: string; paymongoPaymentIntentId?: string; paidAt?: string; receiptUrl?: string; platformFeeAmount?: number; platformFeeRate?: number; platformFeeSettled?: boolean; payoutAmount?: number; payoutSettled?: boolean; booking?: Booking; }
export interface Booking { id: string; status: string; price: number; notes?: string; coach?: Coach; client?: User; timeSlot?: TimeSlot; sportCategory?: SportCategory; payment?: Payment; cancellationReason?: string; createdAt?: string; }
export interface Review { id: string; rating: number; comment?: string; isApproved?: boolean; isFlagged?: boolean; flagReason?: string; createdAt: string; client?: User; coach?: Coach; booking?: Booking; }
export interface AppNotification { id: string; title: string; message: string; isRead: boolean; createdAt: string; }
export interface Message { id: string; content: string; isRead: boolean; createdAt: string; sender?: User; recipient?: User; bookingId: string; }
export interface DashboardStats { totalUsers: number; totalCoaches: number; totalClients: number; totalRevenue: number; bookingsByStatus: Record<string, number>; reviewsPendingModeration: number; recentBookings: Booking[]; gcashCommissionOwed: number; gcashPayoutOwed: number; totalCommissionEarned: number; }
export interface SavedPaymentMethod { id: string; brand: string; last4: string; expMonth: number; expYear: number; isDefault: boolean; }

const API_URL = import.meta.env.VITE_API_URL || '/api';

function getStoredToken(): string | null {
  try {
    const raw = localStorage.getItem('coachconnect_session') || localStorage.getItem('stride_session');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { token?: string };
    return parsed.token || null;
  } catch {
    return null;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const details = Array.isArray(body.errors) ? body.errors.filter(Boolean).join(' ') : '';
    throw new Error([body.message, details].filter(Boolean).join(': ') || 'Something went wrong.');
  }
  return body;
}

const qs = (params: Record<string, string | number | boolean | undefined>) => {
  const parts = Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
};

export const api = {
  // ---- Auth ----
  login: (payload: { email: string; password: string }) => request<{ data: { user: User; token: string } }>('/auth/login', { method: 'POST', body: JSON.stringify(payload) }),
  register: (payload: { name: string; email: string; password: string; role: Role }) => request<{ data: { user: User; token: string } }>('/auth/register', { method: 'POST', body: JSON.stringify(payload) }),
  forgotPassword: (email: string) => request<{ message: string }>('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),

  // ---- Profile ----
  profile: () => request<{ data: User }>('/users/profile'),
  updateProfile: (payload: Partial<{ name: string; phone: string; dateOfBirth: string; gender: string; emergencyContact: string; fitnessGoals: string; gcashNumber: string; gcashAccountName: string }>) =>
    request<{ data: User }>('/users/profile', { method: 'PUT', body: JSON.stringify(payload) }),
  uploadProfileImage: async (file: File) => {
    const token = getStoredToken();
    const response = await fetch(`${API_URL}/users/profile/image`, { method: 'POST', body: (() => { const form = new FormData(); form.append('image', file); return form; })(), headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || 'Could not upload profile image.');
    return body as { data: { profileImage: string } };
  },

  // ---- Sport categories ----
  sportCategories: () => request<{ data: SportCategory[] }>('/sport-categories'),
  createSportCategory: (payload: { name: string; description?: string; icon?: string }) => request<{ data: SportCategory }>('/sport-categories', { method: 'POST', body: JSON.stringify(payload) }),
  updateSportCategory: (id: string, payload: Partial<SportCategory>) => request<{ data: SportCategory }>(`/sport-categories/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteSportCategory: (id: string) => request<{ message: string }>(`/sport-categories/${id}`, { method: 'DELETE' }),

  // ---- Coaches ----
  coaches: (filters: Partial<{ sport: string; city: string; minPrice: number; maxPrice: number; minRating: number; date: string }> = {}) =>
    request<{ data: Coach[]; meta?: { total: number } }>(`/coaches${qs(filters)}`),
  coach: (id: string) => request<{ data: Coach }>(`/coaches/${id}`),
  updateCoach: (id: string, payload: Partial<{ bio: string; experienceYears: number; hourlyRate: number; location: string; city: string; country: string; gcashNumber: string; gcashAccountName: string; specializations: { sportCategoryId: string; certification?: string; yearsExperience?: number }[] }>) =>
    request<{ data: Coach }>(`/coaches/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  coachReviews: (id: string) => request<{ data: Review[] }>(`/coaches/${id}/reviews`),

  // ---- Availability ----
  availability: (id: string, from = new Date().toISOString().slice(0, 10)) => request<{ data: { recurringRules: Availability[]; timeSlots: TimeSlot[] } }>(`/coaches/${id}/availability?from=${from}`),
  createAvailability: (payload: { coachId: string; isRecurring: boolean; dayOfWeek?: number; specificDate?: string; startTime: string; endTime: string }) =>
    request<{ data: Availability }>('/coaches/availability', { method: 'POST', body: JSON.stringify(payload) }),
  deleteAvailability: (id: string) => request<{ message: string }>(`/coaches/availability/${id}`, { method: 'DELETE' }),
  generateSlots: (id: string, payload: { from: string; to: string; slotDurationMinutes?: number }) =>
    request<{ data: { count: number } }>(`/coaches/availability/${id}/generate-slots`, { method: 'POST', body: JSON.stringify(payload) }),

  // ---- Bookings ----
  bookings: (filters: Partial<{ status: string; timeframe: 'upcoming' | 'past' }> = {}) => request<{ data: Booking[]; meta?: { total: number } }>(`/bookings${qs(filters)}`),
  booking: (id: string) => request<{ data: Booking }>(`/bookings/${id}`),
  createBooking: (payload: { coachId: string; timeSlotId: string; sportCategoryId: string; notes?: string }) => request<{ data: Booking }>('/bookings', { method: 'POST', body: JSON.stringify(payload) }),
  cancelBooking: (id: string, reason?: string) => request<{ data: Booking }>(`/bookings/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }),
  updateBookingStatus: (id: string, status: 'confirmed' | 'completed' | 'cancelled') => request<{ data: Booking }>(`/bookings/${id}`, { method: 'PUT', body: JSON.stringify({ status }) }),
  rescheduleBooking: (id: string, newTimeSlotId: string) => request<{ data: Booking }>(`/bookings/${id}/reschedule`, { method: 'POST', body: JSON.stringify({ newTimeSlotId }) }),

  // ---- Messages ----
  messages: () => request<{ data: Message[] }>('/messages'),
  unreadMessageCount: () => request<{ data: { count: number } }>('/messages/unread-count'),
  sendMessage: (payload: { bookingId: string; content: string }) => request<{ data: Message }>('/messages', { method: 'POST', body: JSON.stringify(payload) }),

  // ---- Payments ----
  createPayment: (bookingId: string) => request<{ data: { payment: Payment; clientSecret: string } }>('/payments', { method: 'POST', body: JSON.stringify({ bookingId }) }),

  // ---- GCash ----
  gcashInfo: (bookingId: string) => request<{ data: { number: string; accountName: string; platformFeeRate: number; paymongoConfigured: boolean } }>(`/payments/gcash-info/${bookingId}`),
  platformGcashAccount: () => request<{ data: { number: string; accountName: string } }>('/payments/platform-gcash-account'),
  startGcashCheckout: (bookingId: string) => request<{ data: { redirectUrl: string } }>('/payments/gcash/checkout', { method: 'POST', body: JSON.stringify({ bookingId }) }),
  submitGcashPayment: (payload: { bookingId: string; referenceNumber: string }) => request<{ data: Payment }>('/payments/gcash', { method: 'POST', body: JSON.stringify(payload) }),
  confirmGcashPayment: (paymentId: string) => request<{ data: Payment }>(`/payments/${paymentId}/confirm-gcash`, { method: 'PUT' }),
  rejectGcashPayment: (paymentId: string) => request<{ data: Payment }>(`/payments/${paymentId}/reject-gcash`, { method: 'PUT' }),

  // ---- Saved payment methods ----
  createSetupIntent: () => request<{ data: { clientSecret: string } }>('/payments/methods/setup-intent', { method: 'POST' }),
  paymentMethods: () => request<{ data: SavedPaymentMethod[] }>('/payments/methods'),
  deletePaymentMethod: (id: string) => request<{ message: string }>(`/payments/methods/${id}`, { method: 'DELETE' }),
  setDefaultPaymentMethod: (id: string) => request<{ message: string }>(`/payments/methods/${id}/default`, { method: 'PUT' }),

  // ---- Reviews ----
  createReview: (payload: { bookingId: string; rating: number; comment?: string }) => request<{ data: Review }>('/reviews', { method: 'POST', body: JSON.stringify(payload) }),
  deleteReview: (id: string) => request<{ message: string }>(`/reviews/${id}`, { method: 'DELETE' }),
  moderateReview: (id: string, payload: Partial<{ isApproved: boolean; isFlagged: boolean; flagReason: string }>) => request<{ data: Review }>(`/reviews/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),

  // ---- Notifications ----
  notifications: (unreadOnly = false) => request<{ data: AppNotification[] }>(`/notifications${qs({ unreadOnly })}`),
  markNotificationRead: (id: string) => request<{ data: AppNotification }>(`/notifications/${id}/read`, { method: 'PUT' }),

  // ---- Admin ----
  adminStats: () => request<{ data: DashboardStats }>('/admin/dashboard/stats'),
  adminUsers: (filters: Partial<{ role: Role; isActive: boolean; search: string }> = {}) => request<{ data: User[]; meta?: { total: number } }>(`/admin/users${qs(filters)}`),
  adminCreateUser: (payload: { name: string; email: string; password: string; phone?: string; role: Role }) => request<{ data: User }>('/admin/users', { method: 'POST', body: JSON.stringify(payload) }),
  adminUpdateUser: (id: string, payload: Partial<{ name: string; phone: string; role: Role; isActive: boolean; emailVerified: boolean }>) => request<{ data: User }>(`/admin/users/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  adminDeleteUser: (id: string) => request<{ message: string }>(`/admin/users/${id}`, { method: 'DELETE' }),
  adminVerifyCoach: (coachId: string, isVerified: boolean) => request<{ data: Coach }>(`/admin/coaches/${coachId}/verify`, { method: 'PUT', body: JSON.stringify({ isVerified }) }),
  adminReviews: (filters: Partial<{ flagged: boolean; approved: boolean }> = {}) => request<{ data: Review[]; meta?: { total: number } }>(`/admin/reviews${qs(filters)}`),
  adminGcashCommissions: (filters: Partial<{ settled: boolean }> = {}) => request<{ data: Payment[]; meta?: { total: number; totalOwed: number } }>(`/admin/gcash-commissions${qs(filters)}`),
  adminSettleGcashCommission: (paymentId: string, settled = true) => request<{ data: Payment }>(`/admin/gcash-commissions/${paymentId}/settle`, { method: 'PUT', body: JSON.stringify({ settled }) }),
  adminGcashPayouts: (filters: Partial<{ settled: boolean }> = {}) => request<{ data: Payment[]; meta?: { total: number; totalOwed: number } }>(`/admin/gcash-payouts${qs(filters)}`),
  adminSettleGcashPayout: (paymentId: string, settled = true) => request<{ data: Payment }>(`/admin/gcash-payouts/${paymentId}/settle`, { method: 'PUT', body: JSON.stringify({ settled }) }),
};

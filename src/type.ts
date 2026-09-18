export interface UserProfile {
  id: string;
  uid: string;
  email: string;

  firstName: string;
  lastName: string;
  fullName: string;

  role: string;
  status: string;

  createdAt: any;
  updatedAt: any;

  shareBalance?: number;
  loanBalance?: number;
  loanLimit?: number;
  approvedAt?: any;
  monthlyShareCommitment?: number;

  // ✅ NEW PROFILE FIELDS
  phoneNumber?: string;
  address?: string;
  photoURL?: string;
  theme?: string;
}

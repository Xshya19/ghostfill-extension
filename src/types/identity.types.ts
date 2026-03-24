export interface IdentityProfile {
  firstName: string;
  lastName: string;
  fullName: string;
  username: string;
  emailPrefix: string;
  email?: string; // Full email with domain
  password?: string; // Generated password
  cachedPassword?: string; // Persistence for the generated password
}

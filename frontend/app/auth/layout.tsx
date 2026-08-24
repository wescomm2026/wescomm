import { StudentAuthProvider } from "@/components/auth/StudentAuthProvider";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <StudentAuthProvider>{children}</StudentAuthProvider>;
}

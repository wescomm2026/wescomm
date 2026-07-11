import { redirect } from "next/navigation";

export default function LoginPage() {
  redirect("/student/dashboard?auth=login");
}

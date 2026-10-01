"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import { Button } from "@/components/ui/button";
import { getDepartmentsFromApi, type BackendDepartment } from "@/lib/api";
import { userFacingErrorMessage } from "@/lib/user-facing-error";

const STEP_TITLES = ["Department", "Student ID", "Phone", "Address"] as const;

export function StudentOnboardingGate() {
  const router = useRouter();
  const { user, completeOnboarding, logout } = useStudentAuth();
  const [step, setStep] = useState(0);
  const [departments, setDepartments] = useState<BackendDepartment[]>([]);
  const [departmentId, setDepartmentId] = useState("");
  const [studentNumber, setStudentNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user?.accessToken) return;
    let active = true;
    getDepartmentsFromApi(user.accessToken)
      .then((items) => { if (active) setDepartments(items); })
      .catch((loadError) => { if (active) setError(userFacingErrorMessage(loadError, "Unable to load departments.")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user?.accessToken]);

  const groupedDepartments = useMemo(() => departments.reduce((groups, department) => {
    const entries = groups.get(department.groupName) ?? [];
    entries.push(department);
    groups.set(department.groupName, entries);
    return groups;
  }, new Map<string, BackendDepartment[]>()), [departments]);

  const canContinue = step === 0 ? Boolean(departmentId) : step === 1 ? studentNumber.trim().length >= 3 : true;
  const finish = async (addressValue = address) => {
    if (!canContinue) return;
    setSaving(true);
    setError("");
    const result = await completeOnboarding({ departmentId, studentNumber, phone, address: addressValue });
    setSaving(false);
    if (!result.success) setError(result.error ?? "Unable to complete onboarding.");
    else router.replace("/student/dashboard");
  };

  return (
    <main className="grid min-h-screen place-items-center bg-[#f4f8f4] px-4 py-8">
      <section className="w-full max-w-xl rounded-xl border border-[#d8e4d9] bg-white p-6 shadow-xl sm:p-8" aria-labelledby="onboarding-title">
        <p className="text-xs font-extrabold uppercase tracking-wide text-primary">Student profile setup</p>
        <h1 id="onboarding-title" className="mt-2 text-2xl font-extrabold text-[#17211b]">{STEP_TITLES[step]}</h1>
        <p className="mt-2 text-sm leading-6 text-[#657169]">Step {step + 1} of {STEP_TITLES.length}. Department and Student ID are required before reservations can be made.</p>
        <div className="mt-5 grid grid-cols-4 gap-2" aria-label="Onboarding progress">
          {STEP_TITLES.map((title, index) => <span key={title} className={`h-2 rounded-full ${index <= step ? "bg-primary" : "bg-[#dce5dd]"}`} />)}
        </div>

        <div className="mt-7 min-h-40">
          {step === 0 ? (
            <label className="grid gap-2 text-sm font-bold">What is your department?
              <select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} disabled={loading} className="h-12 rounded-md border border-[#ccd8cd] bg-white px-3 font-normal outline-none focus:border-primary">
                <option value="">{loading ? "Loading departments..." : "Select your department"}</option>
                {Array.from(groupedDepartments).map(([group, items]) => <optgroup key={group} label={group}>{items.map((department) => <option key={department.id} value={department.id}>{department.displayName}</option>)}</optgroup>)}
              </select>
            </label>
          ) : step === 1 ? (
            <label className="grid gap-2 text-sm font-bold">Enter your Student ID Number
              <input autoFocus value={studentNumber} onChange={(event) => setStudentNumber(event.target.value.toUpperCase())} maxLength={40} className="h-12 rounded-md border border-[#ccd8cd] px-3 font-normal outline-none focus:border-primary" placeholder="Student ID" />
            </label>
          ) : step === 2 ? (
            <label className="grid gap-2 text-sm font-bold">Add your phone number <span className="font-normal text-[#657169]">Optional</span>
              <input autoFocus value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={32} inputMode="tel" className="h-12 rounded-md border border-[#ccd8cd] px-3 font-normal outline-none focus:border-primary" placeholder="Phone number" />
            </label>
          ) : (
            <label className="grid gap-2 text-sm font-bold">Add your address <span className="font-normal text-[#657169]">Optional</span>
              <textarea autoFocus value={address} onChange={(event) => setAddress(event.target.value)} maxLength={500} className="min-h-28 rounded-md border border-[#ccd8cd] px-3 py-2 font-normal outline-none focus:border-primary" placeholder="Address" />
            </label>
          )}
          {error ? <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700" role="alert">{error}</p> : null}
        </div>

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
          {step > 0 ? <Button variant="secondary" onClick={() => { setError(""); setStep((current) => current - 1); }} disabled={saving}><ArrowLeft className="size-4" />Back</Button> : <Button variant="ghost" onClick={() => void logout()} disabled={saving}>Sign out</Button>}
          <div className="flex gap-2">
            {step === 2 ? <Button variant="secondary" onClick={() => { setPhone(""); setError(""); setStep(3); }} disabled={saving}>Skip</Button> : null}
            {step === 3 ? <Button variant="secondary" onClick={() => { setAddress(""); void finish(""); }} disabled={saving}>Skip</Button> : null}
            {step < STEP_TITLES.length - 1 ? <Button onClick={() => { setError(""); setStep((current) => current + 1); }} disabled={!canContinue || loading}><ArrowRight className="size-4" />Continue</Button> : <Button onClick={() => void finish()} loading={saving} disabled={!canContinue}><Check className="size-4" />Finish</Button>}
          </div>
        </div>
      </section>
    </main>
  );
}

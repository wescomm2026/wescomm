// Curated from WESCOMM's as-built business rules and published FAQs.
// This is the DEFAULT grounding knowledge; it can be overridden at runtime via
// the AppSetting key "wesbot.knowledge" (a JSON array of fact strings).
// Gemini uses it only as grounding reference; it must not invent beyond it.
export const WESCOMM_DEFAULT_KNOWLEDGE = [
  "WESCOMM is the Wesleyan University - Philippines commissary management system for browsing and reserving campus items such as uniforms, ID accessories, school supplies, and textbooks.",
  "WESCOMM product categories include uniforms, ID accessories, school supplies, and textbooks.",
  "A product can be simple (a single item), option-based (with selectable sizes or colors), or cloth sold by quantity without sizes.",
  "WESCOMM accepts cash only for new reservations. Students may choose to pay at the Commissary or at the Treasury. GCash, e-wallet, and online payments are not accepted for new reservations. Historical online GCash payments remain visible on older records.",
  "Operating hours are 10:00 AM to 4:30 PM, and WESCOMM is normally closed on Saturday and Sunday.",
  "WESCOMM is located at Mabini Extension, Cabanatuan City, Philippines, 3100, and can be contacted at wescomm2026@gmail.com.",
  "Reservation status moves in order: Pending, then Confirmed, then Ready for Pickup, then Completed. A reservation may also be Cancelled or marked No Show.",
  "Only students can create reservations. Stock is held immediately when a reservation is created.",
  "For no-shows, the first two consecutive no-shows produce warnings only. The third escalates to a 7-day restriction, then 30 days, then indefinite review. Completing a pickup resets the sequence.",
  "A student may cancel a Pending reservation that has no payment issue. Other cancellations and status changes are handled by Staff or Admin.",
  "Completing a reservation creates a receipt that starts Pending; Staff or Admin then verify or void it. A public receipt code shows only masked information.",
  "Refunds are not automatic. A paid order that needs cancellation goes to Staff review before any refund.",
  "A restricted student cannot create a new reservation but can still use other features like receipts and Support.",
  "Saving an item to the wishlist does not hold stock. Only a successful reservation holds stock.",
  "Some uniform items are sold as cloth by quantity only and have no selectable size or color.",
  "Students can update their own full name, phone, department, and address through Account Settings. Role, email, and student number are read-only for students.",
  "To change your department, open Account Settings, edit the Department field, then save. If you cannot change it there, contact WESCOMM Staff or Admin."
];

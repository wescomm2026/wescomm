import Image from "next/image";
import { cn } from "@/lib/utils";

const sizeClasses = {
  sm: { shell: "size-8", icon: "size-6" },
  md: { shell: "size-9", icon: "size-7" },
  lg: { shell: "size-11", icon: "size-9" }
} as const;

export function StudentNavIcon({
  src,
  active = false,
  size = "md",
  className
}: {
  src: string;
  active?: boolean;
  size?: keyof typeof sizeClasses;
  className?: string;
}) {
  const classes = sizeClasses[size];

  return (
    <span
      aria-hidden="true"
      className={cn(
        "student-nav-icon-shell grid shrink-0 place-items-center rounded-lg transition-[background-color,box-shadow,transform]",
        classes.shell,
        active && "student-nav-icon-shell-active",
        className
      )}
    >
      <Image src={src} alt="" width={44} height={44} className={cn("object-contain", classes.icon)} />
    </span>
  );
}

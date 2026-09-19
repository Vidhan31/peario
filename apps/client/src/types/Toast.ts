export type ToastType = "info" | "warning" | "error" | "success";

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message: string;
  duration?: number;
}

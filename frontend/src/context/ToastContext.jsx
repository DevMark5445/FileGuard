import { createContext, useCallback, useContext, useState } from "react";

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [message, setMessage] = useState("");
  const toast = useCallback((nextMessage) => {
    setMessage(nextMessage);
    window.setTimeout(() => setMessage(""), 2500);
  }, []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      {message && <div className="toast" role="status">{message}</div>}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const toast = useContext(ToastContext);
  if (!toast) throw new Error("useToast must be used within ToastProvider.");
  return toast;
}

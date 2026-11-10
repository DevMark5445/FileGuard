import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [notification, setNotification] = useState(null);
  const timeoutRef = useRef(null);

  const toast = useCallback((message, type = "info") => {
    window.clearTimeout(timeoutRef.current);
    setNotification({ message, type });
    timeoutRef.current = window.setTimeout(() => setNotification(null), 3000);
  }, []);

  useEffect(() => () => window.clearTimeout(timeoutRef.current), []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      {notification && (
        <div
          className={`toast toast-${notification.type}`}
          role={notification.type === "error" ? "alert" : "status"}
        >
          {notification.message}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const toast = useContext(ToastContext);
  if (!toast) throw new Error("useToast must be used within ToastProvider.");
  return toast;
}

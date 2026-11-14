import { useEffect, useState } from "react";

export function useTransientMessage(timeout = 2200) {
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!message) {
      return;
    }

    const timer = window.setTimeout(() => {
      setMessage("");
    }, timeout);

    return () => {
      window.clearTimeout(timer);
    };
  }, [message, timeout]);

  return [message, setMessage] as const;
}

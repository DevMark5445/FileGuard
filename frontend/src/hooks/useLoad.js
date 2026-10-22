import { useCallback, useEffect, useState } from "react";
import { errMsg } from "../utils.js";

export default function useLoad(load, initialData) {
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [request, setRequest] = useState(0);

  const reload = useCallback(() => setRequest((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    load()
      .then((result) => {
        if (active) setData(result);
      })
      .catch((reason) => {
        if (active) setError(errMsg(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [load, request]);

  return { data, loading, error, reload };
}

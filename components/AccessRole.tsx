"use client";

import { createContext, useContext } from "react";

// This role sees the Dashboard and Fuel without the app's report actions.
export const AccessRole = createContext("");
export const useAccessRole = () => useContext(AccessRole);

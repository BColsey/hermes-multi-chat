import type * as ReactTypes from "react";
export interface WorkspaceData {
  projects: Array<{
    name: string;
    archived: boolean;
    primary_path?: string;
    folders: Array<{ path: string; label: string | null }>;
  }>;
  repos: Array<{ root: string; label: string }>;
  default_cwd: string;
  home?: string;
}
export interface SessionRow {
  id: string;
  title?: string | null;
  cwd?: string;
  model?: string;
  is_active?: boolean;
}
export interface SDK {
  sdkVersion: string;
  React: typeof ReactTypes;
  fetchJSON<T>(path: string, init?: RequestInit): Promise<T>;
  buildWsUrl(path: string, params?: Record<string, string>): Promise<string>;
}
declare global {
  interface Window {
    __HERMES_PLUGIN_SDK__?: SDK;
    __HERMES_PLUGINS__?: {
      register(name: string, component: ReactTypes.ComponentType): void;
    };
    __HERMES_DASHBOARD_PROFILE__?: string;
  }
}
export const sdk = window.__HERMES_PLUGIN_SDK__!;
export const React = sdk?.React;

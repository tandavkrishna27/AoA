import { api } from "./client";

export interface ServiceDefinition { command: string; args: string[]; gracefulStopSeconds: number }
export interface ServiceSummary { serviceId: string; desiredState: string; generation: number; createdAt: string; updatedAt: string }
export interface ServiceDetail extends ServiceSummary {
  definition: ServiceDefinition | null;
  liveInstance: { serviceInstanceId: string; status: string; generation: number; jobId: string | null } | null;
}
const root = (organizationId: string, companyId: string) => `/organizations/${organizationId}/companies/${companyId}/services`;
export const serviceControlApi = {
  list: (organizationId: string, companyId: string) => api.get<ServiceSummary[]>(root(organizationId, companyId)),
  detail: (organizationId: string, companyId: string, serviceId: string) => api.get<ServiceDetail>(`${root(organizationId, companyId)}/${serviceId}`),
  create: (organizationId: string, companyId: string, definition: ServiceDefinition) =>
    api.post<{ serviceId: string }>(root(organizationId, companyId), { definition, desiredState: "paused" }),
  desiredState: (organizationId: string, companyId: string, serviceId: string, desiredState: "running" | "paused" | "stopped", reason: string) =>
    api.post<unknown>(`${root(organizationId, companyId)}/${serviceId}/desired-state`, { desiredState, reason }),
  generation: (organizationId: string, companyId: string, serviceId: string, definition: ServiceDefinition, reason: string) =>
    api.post<unknown>(`${root(organizationId, companyId)}/${serviceId}/generation`, { definition, reason }),
};

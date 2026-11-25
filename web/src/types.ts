export interface Staff { id: number; name: string; email: string; isAdmin: boolean; active: boolean; joined: boolean }
export type SessionMode = 'in_person' | 'online' | 'hybrid';
export type TicketMode = 'in_person' | 'online';
export type TicketStatus = 'waiting' | 'helping' | 'done' | 'removed' | 'left';

export interface PublicSession { title: string; mode: SessionMode; location: string | null; status: 'open' | 'paused' | 'closed'; closesAt: string; joinCode: string }

export interface JoinInfo {
  course: string; topics: string[]; emailDomain: string; fairnessMinutes: number;
  session: PublicSession; waitingCount: number; waitMinutes: number;
}

export interface StudentView {
  course: string; fairnessMinutes: number; session: PublicSession; waitingCount: number;
  ticket: {
    id: number; name: string | null; topic: string; description: string | null; mode: TicketMode; where: string | null;
    status: TicketStatus; away: boolean; helpedBefore: number; joinedAt: string;
    position: number | null; waitMinutes: number | null; helper: string | null; joinLink: string | null;
  };
}

export interface StaffTicket {
  id: number; name: string | null; topic: string; description: string | null; mode: TicketMode; where: string | null;
  status: TicketStatus; away: boolean; helpedBefore: number; joinedAt: string; startedAt: string | null;
  helper: string | null; staffId: number | null; groupId: number | null; addedByStaff: boolean; position: number | null;
}

export interface StaffView {
  session: PublicSession & { id: number; onlineLink: string | null; openedAt: string };
  waiting: StaffTicket[]; helping: StaffTicket[]; helpedCount: number; avgHelpMinutes: number; activeStaff: number;
}

export interface SessionSummary extends PublicSession { id: number; openedAt: string }

export interface Settings { courseName: string; emailDomain: string; timezone: string; topics: string[]; fairnessMinutes: number }

export interface Stats {
  session: { id: number; title: string; openedAt: string; closedAt: string | null; status: string };
  joined: number; helped: number; leftOrRemoved: number; repeatVisitors: number;
  medianWaitMinutes: number | null; longestWaitMinutes: number | null; medianHelpMinutes: number | null;
  byMode: { in_person: number; online: number }; topics: { topic: string; count: number }[];
}

export interface DisplayView { course: string; session: PublicSession; waitingCount: number; waitMinutes: number; nowHelping: number }

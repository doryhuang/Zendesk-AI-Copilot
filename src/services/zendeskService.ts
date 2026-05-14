export interface Ticket {
  id: number;
  subject: string;
  description: string;
  status: string;
  updated_at: string;
}

export interface Comment {
  id: number;
  body: string;
  author_id: number;
  created_at: string;
}

export async function fetchRecentTickets(): Promise<{ tickets: Ticket[], error?: string }> {
  try {
    const response = await fetch("/api/zendesk/tickets");
    const data = await response.json();
    if (!response.ok) {
      return { tickets: [], error: data.details || data.error || "Unknown error" };
    }
    return { tickets: data.tickets || [] };
  } catch (error) {
    console.error(error);
    return { tickets: [], error: "Network error or server is down" };
  }
}

export async function fetchSingleTicket(ticketId: number): Promise<Ticket | null> {
  try {
    const response = await fetch(`/api/zendesk/tickets/${ticketId}/single`);
    if (!response.ok) throw new Error("Failed to fetch ticket");
    const data = await response.json();
    return data.ticket || null;
  } catch (error) {
    console.error(error);
    return null;
  }
}

export async function fetchTicketComments(ticketId: number): Promise<Comment[]> {
  try {
    const response = await fetch(`/api/zendesk/tickets/${ticketId}`);
    if (!response.ok) throw new Error("Failed to fetch comments");
    const data = await response.json();
    return data.comments || [];
  } catch (error) {
    console.error(error);
    return [];
  }
}

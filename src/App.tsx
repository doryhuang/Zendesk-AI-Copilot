import { useState, useEffect } from 'react';
import { 
  MessageSquare, 
  Ticket as TicketIcon, 
  Zap, 
  Loader2, 
  RefreshCcw, 
  Send, 
  Settings,
  ChevronRight,
  MessageCircle,
  Copy,
  Check
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { fetchRecentTickets, fetchTicketComments, type Ticket, type Comment } from './services/zendeskService';
import { summarizeTicket, suggestReply, suggestChatReply } from './services/geminiService';
import Markdown from 'react-markdown';

export default function App() {
  const [activeTab, setActiveTab] = useState<'tickets' | 'chat' | 'settings'>('tickets');
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [summary, setSummary] = useState('');
  const [reply, setReply] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [errorHeader, setErrorHeader] = useState<string | null>(null);
  
  // Chat state
  const [activeChatTicket, setActiveChatTicket] = useState<Ticket | null>(null);
  const [chatLog, setChatLog] = useState('');
  const [chatSuggestions, setChatSuggestions] = useState('');
  const [isLiveEnabled, setIsLiveEnabled] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isZendeskMode, setIsZendeskMode] = useState(false);

  const [searchLoading, setSearchLoading] = useState(false);

  // Settings
  const [customPrompt, setCustomPrompt] = useState('');

  const [subdomain, setSubdomain] = useState('');

  useEffect(() => {
    console.log("App mounted");
    // 獲取設定
    fetch('/api/config')
      .then(r => r.json())
      .then(data => {
        console.log("Config loaded:", data);
        setSubdomain(data.subdomain);
      })
      .catch(err => console.error("Config fetch error:", err));

    // 偵測是否由 Zendesk 傳入參數
    const params = new URLSearchParams(window.location.search);
    const idParam = params.get('ticket_id');
    console.log("ticket_id param:", idParam);
    
    if (idParam) {
      setIsZendeskMode(true);
      const tid = parseInt(idParam);
      if (!isNaN(tid)) {
        autoLoadZendeskTicket(tid);
      }
    } else {
      loadTickets();
    }

    // 初始化 Zendesk SDK (如果有)
    if ((window as any).ZAFClient) {
      console.log("ZAFClient detected, initializing...");
      try {
        const client = (window as any).ZAFClient.init();
        if (client && typeof client.invoke === 'function') {
          client.invoke('resize', { width: '100%', height: '600px' });
          
          // 嘗試從 Zendesk SDK 獲取當前工單 ID
          client.get('ticket.id').then((data: any) => {
            console.log("ZAF ticket data fetched:", data);
            const tid = data['ticket.id'];
            if (tid) {
              setIsZendeskMode(true);
              autoLoadZendeskTicket(tid);
            }
          }).catch((err: any) => console.error("ZAF get error:", err));
        } else {
          console.log("ZAFClient initialized but no invoke function (might not be in Zendesk context)");
        }
      } catch (err) {
        console.error("ZAF init/invoke error:", err);
      }
    } else {
      console.log("ZAFClient NOT detected on window");
    }
  }, []);

  async function autoLoadZendeskTicket(id: number) {
    setLoading(true);
    setAiLoading(true);
    try {
      const response = await fetch(`/api/zendesk/tickets/${id}/single`);
      const data = await response.json();
      if (data.ticket) {
        handleSelectTicket(data.ticket);
      }
    } catch (e) {
      console.error("Auto load error:", e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isLiveEnabled && activeChatTicket) {
      interval = setInterval(() => {
        refreshActiveChat();
      }, 3000); // Polling every 3 seconds for faster live chat response
    }
    return () => clearInterval(interval);
  }, [isLiveEnabled, activeChatTicket]);

  async function searchGlobalTicket() {
    if (!/^\d+$/.test(searchQuery)) return;
    setSearchLoading(true);
    setErrorHeader(null);
    try {
      const response = await fetch(`/api/zendesk/tickets/${searchQuery}/single`);
      if (!response.ok) throw new Error("Ticket not found in Zendesk");
      const data = await response.json();
      if (data.ticket) {
        // Add to list if not present
        if (!tickets.find(t => t.id === data.ticket.id)) {
          setTickets(prev => [data.ticket, ...prev]);
        }
        handleSelectTicket(data.ticket);
      } else {
        setErrorHeader("Ticket ID not found.");
      }
    } catch (e: any) {
      setErrorHeader(e.message || "Failed to find ticket");
    } finally {
      setSearchLoading(false);
    }
  }

  const filteredTickets = tickets.filter(t => 
    t.id.toString().includes(searchQuery) || 
    t.subject.toLowerCase().includes(searchQuery.toLowerCase())
  );

  async function loadTickets() {
    setLoading(true);
    setErrorHeader(null);
    const result = await fetchRecentTickets();
    if (result.error) {
      setErrorHeader(result.error);
      setTickets([]);
    } else {
      setTickets(result.tickets);
    }
    setLoading(false);
  }

  async function handleSelectTicket(ticket: Ticket) {
    setSelectedTicket(ticket);
    setAiLoading(true);
    setSummary('');
    setReply('');
    
    try {
      const ticketComments = await fetchTicketComments(ticket.id);
      setComments(ticketComments);
      
      const fullContent = ticketComments.map(c => c.body).join('\n---\n');
      const aiSummary = await summarizeTicket(fullContent);
      setSummary(aiSummary);
      
      const aiReply = await suggestReply(fullContent, customPrompt);
      setReply(aiReply);
    } catch (error) {
      console.error(error);
    } finally {
      setAiLoading(false);
    }
  }

  async function refreshActiveChat() {
    if (!activeChatTicket) return;
    try {
      const ticketComments = await fetchTicketComments(activeChatTicket.id);
      const fullContent = ticketComments.map(c => c.body).join('\n---\n');
      
      // Only update if content changed or if suggestions are empty
      if (fullContent !== chatLog || !chatSuggestions) {
        setChatLog(fullContent);
        const suggestion = await suggestChatReply(fullContent);
        setChatSuggestions(suggestion);
      }
    } catch (error) {
      console.error("Live refresh error:", error);
    }
  }

  async function handleSelectChatTicket(ticket: Ticket) {
    setActiveChatTicket(ticket);
    setAiLoading(true);
    setChatLog('');
    setChatSuggestions('');
    
    try {
      const ticketComments = await fetchTicketComments(ticket.id);
      const fullContent = ticketComments.map(c => c.body).join('\n---\n');
      setChatLog(fullContent);
      
      const suggestion = await suggestChatReply(fullContent);
      setChatSuggestions(suggestion);
    } catch (error) {
      console.error(error);
    } finally {
      setAiLoading(false);
    }
  }

  async function handleChatAi() {
    if (!chatLog.trim()) return;
    setAiLoading(true);
    const suggestion = await suggestChatReply(chatLog);
    setChatSuggestions(suggestion);
    setAiLoading(false);
  }

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="min-h-screen bg-[#F5F5F0] text-[#1A1A1A] font-sans flex flex-col md:flex-row">
      {/* Sidebar / Navigation */}
      {!isZendeskMode && (
        <nav className="w-full md:w-16 bg-[#151619] flex flex-row md:flex-col items-center py-4 md:py-8 justify-around md:justify-start gap-4 md:gap-8 text-[#8E9299] z-50 shrink-0">
          <div className="text-white hidden md:block">
            <Zap className="w-8 h-8 text-orange-500 fill-orange-500" />
          </div>
          <button 
            onClick={() => setActiveTab('tickets')}
            className={`p-3 rounded-xl transition-colors ${activeTab === 'tickets' ? 'bg-orange-500 text-white' : 'hover:bg-white/10'}`}
            title="Tickets"
          >
            <TicketIcon className="w-6 h-6" />
          </button>
          <button 
            onClick={() => setActiveTab('chat')}
            className={`p-3 rounded-xl transition-colors ${activeTab === 'chat' ? 'bg-orange-500 text-white' : 'hover:bg-white/10'}`}
            title="Live Chat"
          >
            <MessageCircle className="w-6 h-6" />
          </button>
          <div className="md:mt-auto">
            <button 
              onClick={() => setActiveTab('settings')}
              className={`p-3 rounded-xl transition-colors ${activeTab === 'settings' ? 'bg-orange-500 text-white' : 'hover:bg-white/10'}`}
              title="Settings"
            >
              <Settings className="w-6 h-6" />
            </button>
          </div>
        </nav>
      )}

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col md:flex-row h-screen overflow-hidden">
        
        {activeTab === 'tickets' && (
          <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
            {/* Ticket List Section - Collapsible or sidebar width */}
            {!isZendeskMode && (
              <section className={`w-full md:w-80 border-r border-black/10 bg-white flex flex-col shrink-0 ${selectedTicket ? 'hidden md:flex' : 'flex'}`}>
                <header className="p-4 border-bottom border-black/5 bg-[#151619] text-white">
                  <div className="flex justify-between items-center mb-3">
                    <h2 className="text-sm font-medium italic serif">Tickets</h2>
                    <button onClick={loadTickets} disabled={loading} className="p-2 hover:bg-white/10 rounded-full">
                      <RefreshCcw className={`w-3.h-3 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                  </div>
                  <div className="relative flex gap-2">
                    <input 
                      type="text" 
                      placeholder="Search ID or subject..." 
                      className="flex-1 bg-white/10 border border-white/5 rounded-lg py-1.5 px-3 text-[10px] outline-none focus:bg-white/20 transition-all font-mono"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && searchGlobalTicket()}
                    />
                    {/^\d+$/.test(searchQuery) && (
                      <button 
                        onClick={searchGlobalTicket}
                        disabled={searchLoading}
                        className="p-1.5 bg-orange-500 rounded-lg hover:bg-orange-600 transition-colors disabled:opacity-50"
                        title="Fetch by ID"
                      >
                        {searchLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                      </button>
                    )}
                  </div>
                </header>
                <div className="flex-1 overflow-y-auto">
                  {errorHeader && (
                    <div className="p-4 m-2 bg-red-50 border border-red-100 rounded-xl text-red-600 text-[10px] space-y-1">
                      <p className="font-bold">Error</p>
                      <p>{errorHeader}</p>
                    </div>
                  )}
                  {filteredTickets.length === 0 && !loading && !errorHeader && (
                    <div className="p-8 text-center space-y-3">
                      <p className="text-xs text-gray-400">No matching tickets in recent list.</p>
                      {/^\d+$/.test(searchQuery) && (
                        <button 
                          onClick={searchGlobalTicket}
                          className="text-[10px] text-orange-500 font-bold uppercase tracking-wider hover:underline"
                        >
                          Try fetch ID #{searchQuery} directly
                        </button>
                      )}
                    </div>
                  )}
                  {filteredTickets.map((ticket) => (
                    <button
                      key={ticket.id}
                      onClick={() => handleSelectTicket(ticket)}
                      className={`w-full text-left p-4 border-b border-black/5 transition-all hover:bg-gray-50 group ${selectedTicket?.id === ticket.id ? 'bg-orange-50 border-r-2 border-r-orange-500' : ''}`}
                    >
                      <div className="flex justify-between items-start mb-1">
                        <span className="text-[10px] font-mono text-gray-400">#{ticket.id}</span>
                        <span className={`text-[8px] px-1.5 py-0.5 rounded-full uppercase font-bold tracking-wider ${
                          ticket.status === 'open' ? 'bg-red-100 text-red-600' : 
                          ticket.status === 'pending' ? 'bg-blue-100 text-blue-600' : 
                          'bg-gray-100 text-gray-600'
                        }`}>
                          {ticket.status}
                        </span>
                      </div>
                      <h3 className="text-xs font-medium text-gray-900 group-hover:text-orange-600 transition-colors line-clamp-2 leading-snug">
                        {ticket.subject}
                      </h3>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-[9px] text-gray-500">{new Date(ticket.updated_at).toLocaleDateString()}</span>
                        <ChevronRight className="w-3 h-3 text-gray-300 transition-transform group-hover:translate-x-1" />
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* AI Assistant Section */}
            <section className={`flex-1 flex flex-col bg-[#F5F5F0] overflow-y-auto ${!selectedTicket ? 'hidden md:flex' : 'flex'}`}>
              {selectedTicket ? (
                <div className="p-4 md:p-6 w-full space-y-6">
                  <header className="flex justify-between items-start">
                    <div>
                      <button onClick={() => setSelectedTicket(null)} className="md:hidden text-xs text-orange-500 mb-2 font-medium">← Back to tickets</button>
                      <h1 className="text-xl md:text-2xl font-light tracking-tight mb-1">{selectedTicket.subject}</h1>
                      <div className="text-[10px] text-gray-500 font-mono tracking-wider">#{selectedTicket.id}</div>
                    </div>
                  </header>

                  {/* AI Summary Card */}
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white rounded-2xl p-5 shadow-sm border border-black/5"
                  >
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <Zap className="w-4 h-4 text-orange-500" />
                        <h2 className="text-[10px] font-bold uppercase tracking-widest">Summary</h2>
                      </div>
                      {aiLoading && <Loader2 className="w-3 h-3 animate-spin text-orange-500" />}
                    </div>
                    <div className="text-xs text-gray-700 leading-relaxed prose prose-xs max-w-none">
                       {aiLoading && !summary ? (
                        <div className="flex items-center justify-center py-8 text-gray-300">
                          <Loader2 className="w-6 h-6 animate-spin" />
                        </div>
                      ) : (
                        <div className="markdown-body text-xs">
                          <Markdown>{summary}</Markdown>
                        </div>
                      )}
                    </div>
                  </motion.div>

                  {/* Suggestion Card */}
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="bg-white rounded-2xl p-5 shadow-sm border border-black/5"
                  >
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <MessageSquare className="w-4 h-4 text-blue-500" />
                        <h2 className="text-[10px] font-bold uppercase tracking-widest text-[#151619]">Suggestion</h2>
                      </div>
                      {!aiLoading && reply && (
                        <button 
                          onClick={() => copyToClipboard(reply, 'ticket-reply')}
                          className="text-[10px] font-medium text-blue-600 flex items-center gap-1"
                        >
                          {copied === 'ticket-reply' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                          {copied === 'ticket-reply' ? 'Copied' : 'Copy'}
                        </button>
                      )}
                    </div>
                    <div className="bg-gray-50 rounded-xl p-4 text-xs text-gray-700 leading-relaxed font-mono whitespace-pre-wrap min-h-[80px]">
                      {aiLoading && !reply ? (
                         <div className="flex items-center justify-center py-8 text-gray-300">
                          <Loader2 className="w-6 h-6 animate-spin" />
                        </div>
                      ) : (
                        reply || "Generate suggestion..."
                      )}
                    </div>
                  </motion.div>

                   {/* History Preview */}
                   <details className="group">
                    <summary className="text-[10px] font-bold uppercase tracking-widest text-gray-400 cursor-pointer list-none flex items-center gap-2 mb-4">
                      <ChevronRight className="w-3 h-3 group-open:rotate-90 transition-transform" />
                      Original Conversation
                    </summary>
                    <div className="space-y-3 pl-2">
                      {comments.map((comment) => (
                        <div key={comment.id} className="bg-white/40 rounded-xl p-4 border border-black/5 text-[11px]">
                          <div className="flex justify-between mb-1 opacity-50 text-[8px] font-mono">
                            <span>Author {comment.author_id}</span>
                            <span>{new Date(comment.created_at).toLocaleTimeString()}</span>
                          </div>
                          <p className="text-gray-600 line-clamp-3 hover:line-clamp-none whitespace-pre-wrap">{comment.body}</p>
                        </div>
                      ))}
                    </div>
                  </details>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-gray-400 p-8 text-center">
                  <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-inner border border-black/5 mb-4">
                    <TicketIcon className="w-6 h-6 opacity-20" />
                  </div>
                  <p className="text-xs italic serif">Select a ticket</p>
                </div>
              )}
            </section>
          </div>
        )}

        {activeTab === 'chat' && (
          <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
            {/* Active Chat List Section */}
            <section className={`w-full md:w-80 border-r border-black/10 bg-white flex flex-col shrink-0 ${activeChatTicket ? 'hidden md:flex' : 'flex'}`}>
              <header className="p-4 border-bottom border-black/5 bg-[#151619] text-white">
                <div className="flex justify-between items-center mb-3">
                  <h2 className="text-sm font-medium italic serif">Live Chats</h2>
                  <div className="flex items-center gap-2">
                    <span className="text-[8px] font-mono tracking-wider opacity-60">LIVE</span>
                    <button 
                      onClick={() => setIsLiveEnabled(!isLiveEnabled)}
                      className={`w-8 h-4 rounded-full transition-colors relative ${isLiveEnabled ? 'bg-orange-500' : 'bg-gray-700'}`}
                    >
                      <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${isLiveEnabled ? 'right-0.5' : 'left-0.5'}`}></div>
                    </button>
                  </div>
                </div>
                <div className="relative">
                  <input 
                    type="text" 
                    placeholder="Find active chat ID..." 
                    className="w-full bg-white/10 border border-white/5 rounded-lg py-1.5 px-3 text-[10px] outline-none focus:bg-white/20 transition-all font-mono"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
              </header>
              <div className="flex-1 overflow-y-auto">
                {tickets
                  .filter(t => t.id.toString().includes(searchQuery))
                  .map((ticket) => (
                  <button
                    key={ticket.id}
                    onClick={() => handleSelectChatTicket(ticket)}
                    className={`w-full text-left p-3 border-b border-black/5 transition-colors group ${
                      activeChatTicket?.id === ticket.id ? 'bg-[#151619] text-white' : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex justify-between items-start mb-1">
                      <span className="text-[9px] font-mono opacity-60">#{ticket.id}</span>
                      {activeChatTicket?.id === ticket.id && isLiveEnabled && (
                        <span className="flex h-2 w-2 relative">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-orange-500"></span>
                        </span>
                      )}
                    </div>
                    <h3 className="text-xs font-medium line-clamp-1 mb-1">{ticket.subject}</h3>
                    <p className={`text-[9px] opacity-60 uppercase tracking-widest font-mono`}>{ticket.status}</p>
                  </button>
                ))}
              </div>
            </section>

            {/* Chat Copilot Section */}
            <section className={`flex-1 flex flex-col bg-[#F5F5F0] overflow-y-auto ${!activeChatTicket ? 'hidden md:flex' : 'flex'}`}>
              {activeChatTicket ? (
                <div className="p-4 md:p-6 w-full space-y-6">
                  <header>
                    <button onClick={() => setActiveChatTicket(null)} className="md:hidden text-xs text-orange-500 mb-2 font-medium">← Back to chats</button>
                    <h1 className="text-xl md:text-2xl font-light tracking-tight mb-1">Chat Assistant</h1>
                    <div className="flex items-center gap-3 text-[10px] text-gray-500 font-mono uppercase tracking-widest">
                      <span>#{activeChatTicket.id}</span>
                      <span className={isLiveEnabled ? 'text-orange-500 font-bold' : ''}>
                        {isLiveEnabled ? 'LIVE 3s' : 'PAUSED'}
                      </span>
                    </div>
                  </header>

                  <div className="bg-white rounded-2xl p-5 shadow-sm border border-black/5">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <MessageCircle className="w-4 h-4 text-green-500" />
                        <h2 className="text-[10px] font-bold uppercase tracking-widest">Templates</h2>
                      </div>
                      {aiLoading && <Loader2 className="w-3 h-3 animate-spin text-orange-500" />}
                    </div>
                    
                    <div className="text-xs text-gray-700 prose prose-xs max-w-none">
                      {aiLoading && !chatSuggestions ? (
                        <div className="flex items-center justify-center p-8">
                          <Loader2 className="w-6 h-6 animate-spin text-gray-200" />
                        </div>
                      ) : (
                        <div className="markdown-body text-xs">
                          <Markdown>{chatSuggestions || "No suggestions yet."}</Markdown>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Transcript Preview */}
                  <div className="opacity-40">
                    <h3 className="text-[9px] font-bold uppercase tracking-widest mb-2">Transcript Preview</h3>
                    <div className="bg-gray-200 rounded-xl p-4 text-[10px] font-mono max-h-40 overflow-y-auto whitespace-pre-wrap">
                      {chatLog}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-gray-400 p-8 text-center">
                  <MessageCircle className="w-10 h-10 opacity-10 mb-4" />
                  <p className="text-xs italic serif">Select an active chat</p>
                </div>
              )}
            </section>
          </div>
        )
        }

        {activeTab === 'settings' && (
          <section className="flex-1 bg-[#F5F5F0] overflow-y-auto flex flex-col p-6 items-center">
             <div className="max-w-md w-full space-y-6">
              <header className="text-center">
                <h1 className="text-2xl font-light tracking-tight mb-1">Settings</h1>
                <p className="text-xs text-gray-500 italic serif">Assistant Customization</p>
              </header>

              <div className="bg-white rounded-2xl p-6 shadow-sm border border-black/5 space-y-6">
                <div>
                  <h3 className="text-[10px] font-bold uppercase tracking-widest mb-2">Custom AI Prompt</h3>
                  <textarea 
                    className="w-full h-24 bg-gray-50 border border-black/5 rounded-xl p-3 text-xs focus:ring-1 focus:ring-orange-500 outline-none transition-all placeholder:italic"
                    placeholder="e.g. Please reply as if you were a pirate support agent..."
                    value={customPrompt}
                    onChange={(e) => setCustomPrompt(e.target.value)}
                  />
                </div>

                <div className="pt-4 border-t border-black/5">
                  <h3 className="text-[10px] font-bold uppercase tracking-widest mb-2">Connection Status</h3>
                  <div className="text-[10px] font-mono bg-gray-50 p-3 rounded-lg border border-black/5 opacity-60">
                    Subdomain: {subdomain || 'Loading...'}
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

import { useState } from "@lynx-js/react";
import type { ConversationItem, ConversationMessageItem } from "./types.js";

export interface MessagesViewProps {
  conversations: ConversationItem[];
  messages: ConversationMessageItem[];
  activeConvoId: string | null;
  draft: string;
  sending: boolean;
  initialRecipient?: string | undefined;
  activeTab?: ("inbox" | "requests") | undefined;
  onTabChange?: ((tab: "inbox" | "requests") => void) | undefined;
  onSelectConversation: (convoId: string) => void;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onStartConversation?: ((recipient: string) => void) | undefined;
  onAccept?: ((convoId: string) => void) | undefined;
  onMute?: ((convoId: string, mute: boolean) => void) | undefined;
  onReact?: ((convoId: string, messageId: string, emoji: string, action: "add" | "remove") => void) | undefined;
  onDeleteForSelf?: ((convoId: string, messageId: string) => void) | undefined;
  authenticated: boolean;
  onLogin: () => void;
}

const QUICK_REACTIONS = ["❤️", "👍", "🔥", "✨", "👀"];

export function MessagesView(props: MessagesViewProps) {
  const {
    conversations,
    messages,
    activeConvoId,
    draft,
    sending,
    activeTab = "inbox",
    initialRecipient,
    onTabChange,
    onSelectConversation,
    onDraftChange,
    onSend,
    onStartConversation,
    onAccept,
    onMute,
    onReact,
    onDeleteForSelf,
    authenticated,
    onLogin
  } = props;

  const [selectedTab, setSelectedTab] = useState<"inbox" | "requests">(activeTab);
  const [showEmojiPickerFor, setShowEmojiPickerFor] = useState<string | null>(null);
  const [showCompose, setShowCompose] = useState(initialRecipient !== undefined && initialRecipient !== "");
  const [composeRecipient, setComposeRecipient] = useState(initialRecipient ?? "");

  const handleTabSwitch = (tab: "inbox" | "requests") => {
    setSelectedTab(tab);
    onTabChange?.(tab);
  };
  const totalUnread = conversations.reduce((n, c) => n + c.unreadCount, 0);

  const activeConvo = conversations.find((c) => c.convoId === activeConvoId);

  return (
    <view className="view-messages">
      {authenticated ? (
        <view className="messages-layout">
          <view className="conversations-list">
            <view className="compose-header-bar" style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid #2A3652;background:#101522;">
              <text style="color:#57E6FF;font-size:11px;font-weight:bold;letter-spacing:1px;">DIRECT COMMS</text>
              <text
                className={showCompose ? "secondary-sm active" : "primary-sm"}
                style="padding:3px 8px;font-size:11px;cursor:pointer;"
                bindtap={() => setShowCompose(!showCompose)}
              >
                {showCompose ? "✕ CLOSE" : "+ NEW CHAT"}
              </text>
            </view>

            {showCompose ? (
              <view className="compose-card" style="padding:12px;background:#171D2E;border-bottom:1px solid #2A3652;display:flex;flex-direction:column;gap:8px;">
                <text style="color:#8792AA;font-size:11px;">RECIPIENT (@handle or DID):</text>
                <input
                  className="input"
                  placeholder="@user.bsky.social or did:plc:..."
                  default-value={composeRecipient}
                  bindinput={(e) => setComposeRecipient(e.detail.value ?? "")}
                  style="width:100%;padding:6px 10px;background:#070910;border:1px solid #2A3652;color:#E8F0FF;font-family:inherit;font-size:12px;"
                />
                <text
                  className="primary-sm"
                  style="align-self:flex-start;padding:5px 12px;font-size:11px;cursor:pointer;"
                  bindtap={() => {
                    if (composeRecipient.trim()) {
                      onStartConversation?.(composeRecipient.trim());
                      setShowCompose(false);
                      setComposeRecipient("");
                    }
                  }}
                >
                  START CONVERSATION &rarr;
                </text>
              </view>
            ) : null}

            <view className="messages-tab-bar">
              <text
                className={selectedTab === "inbox" ? "message-tab active" : "message-tab"}
                bindtap={() => handleTabSwitch("inbox")}
              >
                INBOX{totalUnread > 0 ? ` (${totalUnread})` : ""}
              </text>
              <text
                className={selectedTab === "requests" ? "message-tab active" : "message-tab"}
                bindtap={() => handleTabSwitch("requests")}
              >
                REQUESTS
              </text>
            </view>
            {conversations.length > 0 ? (
              conversations.map((entry) => (
                <view
                  key={entry.convoId}
                  className={entry.convoId === activeConvoId ? "conversation-item active" : "conversation-item"}
                  bindtap={() => onSelectConversation(entry.convoId)}
                >
                  <view className="conversation-meta">
                    <text className="conversation-name">
                      {entry.otherHandle ? `@${entry.otherHandle}` : `Convo ${entry.convoId.slice(0, 8)}`}
                    </text>
                    <view className="convo-badges">
                      {entry.muted ? <text className="muted-badge">MUTED</text> : null}
                      {entry.unreadCount > 0 ? <text className="unread-badge">{entry.unreadCount}</text> : null}
                    </view>
                  </view>
                  {entry.lastMessageText ? (
                    <text className="conversation-preview">{entry.lastMessageText.slice(0, 60)}</text>
                  ) : null}
                </view>
              ))
            ) : (
              <text className="text-empty">
                {selectedTab === "requests" ? "No message requests." : "No conversations yet. Start one from a profile."}
              </text>
            )}
          </view>

          <view className="messages-pane">
            {activeConvoId ? (
              <view className="messages-thread">
                <view className="convo-header">
                  <view className="convo-header-info">
                    <text className="convo-title">
                      {activeConvo?.otherHandle ? `@${activeConvo.otherHandle}` : `Conversation ${activeConvoId.slice(0, 8)}`}
                    </text>
                    {activeConvo?.status === "request" ? (
                      <text className="request-badge">MESSAGE REQUEST</text>
                    ) : null}
                  </view>
                  <view className="convo-actions">
                    {activeConvo?.status === "request" && onAccept ? (
                      <text className="primary-sm" bindtap={() => onAccept(activeConvoId)}>
                        ACCEPT REQUEST
                      </text>
                    ) : null}
                    {onMute ? (
                      <text
                        className="secondary-sm"
                        bindtap={() => onMute(activeConvoId, !activeConvo?.muted)}
                      >
                        {activeConvo?.muted ? "UNMUTE" : "MUTE"}
                      </text>
                    ) : null}
                  </view>
                </view>

                <scroll-view className="messages-scroll" scroll-orientation="vertical">
                  {messages.length > 0 ? (
                    messages.map((m) => (
                      <view key={m.id} className="message-row">
                        <view className="message-bubble">
                          <text className="message-text">{m.text}</text>
                          <view className="message-footer">
                            {m.sentAt ? (
                              <text className="message-time">
                                {new Date(m.sentAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                              </text>
                            ) : null}
                            <text
                              className="react-trigger"
                              bindtap={() => setShowEmojiPickerFor(showEmojiPickerFor === m.id ? null : m.id)}
                            >
                              +😀
                            </text>
                            {onDeleteForSelf ? (
                              <text
                                className="delete-trigger"
                                bindtap={() => onDeleteForSelf(activeConvoId, m.id)}
                              >
                                &times;
                              </text>
                            ) : null}
                          </view>
                        </view>

                        {showEmojiPickerFor === m.id ? (
                          <view className="emoji-picker-row">
                            {QUICK_REACTIONS.map((emoji) => (
                              <text
                                key={emoji}
                                className="emoji-btn"
                                bindtap={() => {
                                  setShowEmojiPickerFor(null);
                                  onReact?.(activeConvoId, m.id, emoji, "add");
                                }}
                              >
                                {emoji}
                              </text>
                            ))}
                          </view>
                        ) : null}

                        {m.reactions && m.reactions.length > 0 ? (
                          <view className="message-reactions">
                            {m.reactions.map((r) => (
                              <view
                                key={r.value}
                                className="reaction-chip"
                                bindtap={() => onReact?.(activeConvoId, m.id, r.value, "remove")}
                              >
                                <text className="reaction-text">{r.value} {r.count}</text>
                              </view>
                            ))}
                          </view>
                        ) : null}
                      </view>
                    ))
                  ) : (
                    <text className="text-empty">No messages in this conversation yet.</text>
                  )}
                </scroll-view>

                <view className="composer-inline">
                  <input
                    className="composer-input"
                    placeholder="Type a direct message…"
                    default-value={draft}
                    bindinput={(e) => onDraftChange(e.detail.value)}
                  />
                  <text className={sending ? "primary-sm sending" : "primary-sm"} bindtap={onSend}>
                    {sending ? "SENDING…" : "SEND"}
                  </text>
                </view>
              </view>
            ) : (
              <view className="empty-card">
                <text className="empty-text">Select a conversation from the left to read and send messages.</text>
              </view>
            )}
          </view>
        </view>
      ) : (
        <view className="content">
          <text className="kicker">DIRECT MESSAGES // ENCRYPTED COMMS</text>
          <text className="title">authentication required</text>
          <view className="auth-card" bindtap={onLogin} style="margin-top:24px;cursor:pointer;">
            <text className="primary" style="padding:12px 24px;display:inline-block;">SIGN IN WITH AT PROTOCOL &rarr;</text>
          </view>
        </view>
      )}
    </view>
  );
}

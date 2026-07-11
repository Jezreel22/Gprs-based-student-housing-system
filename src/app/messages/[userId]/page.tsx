// /messages/[userId] re-exports the same component as /messages.
// The base page reads userId from useParams() and the URL is what determines
// which conversation opens.
import Messages from "../page";

export default function MessagesWithUser() {
  return <Messages />;
}
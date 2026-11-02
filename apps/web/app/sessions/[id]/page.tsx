import { ChatView } from "@/components/ChatView";

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // key로 세션마다 새로 마운트한다. 같은 컴포넌트를 재사용하면 입력 중이던 텍스트·스크롤 위치가 다른 세션으로 넘어간다.
  return <ChatView key={id} sessionId={id} />;
}

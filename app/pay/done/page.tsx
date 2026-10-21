const COPY: Record<string, [string, string]> = {
  paid: ['Payment received, thank you!', 'Your order is confirmed. The seller has been notified.'],
  pending: ['Almost there', 'PayPal is still processing your payment. You will get an email shortly.'],
  cancelled: ['Payment cancelled', 'No money was taken. You can reopen the link from the seller any time.'],
  error: ['Something went wrong', 'Your payment was not completed. Please contact the seller.'],
  unknown: ['Link expired', 'We could not find that order.'],
};

export default async function PayDone({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const { state = 'unknown' } = await searchParams;
  const [title, body] = COPY[state] ?? COPY.unknown!;
  return (
    <div className="hosted">
      <div className="card card-b" style={{ textAlign: 'center' }}>
        <h2>{title}</h2>
        <p className="muted">{body}</p>
      </div>
    </div>
  );
}

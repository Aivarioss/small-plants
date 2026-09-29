type LoginPageProps = {
  searchParams?: Promise<{
    error?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const error = params?.error;

  return (
    <main className="login-shell">
      <section className="login-panel">
        <div>
          <p className="eyebrow">Privāts plānotājs</p>
          <h1>Small Plants</h1>
        </div>
        <form action="/api/auth/login" method="post" className="login-form">
          <label>
            Parole
            <input autoComplete="current-password" name="password" required type="password" />
          </label>
          {error === "1" ? <p className="form-error">Nepareiza parole.</p> : null}
          {error === "config" ? <p className="form-error">Serverī nav konfigurēts APP_PASSWORD vai APP_SESSION_SECRET.</p> : null}
          <button className="primary-action" type="submit">
            Ieiet
          </button>
        </form>
      </section>
    </main>
  );
}

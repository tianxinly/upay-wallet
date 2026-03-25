import React from "react";

type AuthScreenProps = {
  loginPassword: string;
  loginError: string;
  onLogin: () => void;
  onPasswordChange: (value: string) => void;
};

export default function AuthScreen(props: AuthScreenProps) {
  const { loginPassword, loginError, onLogin, onPasswordChange } = props;
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-title">
          <span className="auth-kicker">安全解锁</span>
          <h2>请输入登录密码</h2>
        </div>
        <div className="hint">已开启安全登录，解锁后方可使用。</div>
        <form
          className="auth-form"
          onSubmit={(e) => {
            e.preventDefault();
            onLogin();
          }}
        >
          <input
            type="password"
            value={loginPassword}
            onChange={(e) => onPasswordChange(e.target.value)}
            placeholder="登录密码"
            autoFocus
          />
          {loginError && <div className="inline-error">{loginError}</div>}
          <button className="primary-button" type="submit">
            解锁进入
          </button>
        </form>
        <div className="auth-meta">提示：回车即可解锁；连续失败会触发短时限流</div>
      </div>
    </div>
  );
}

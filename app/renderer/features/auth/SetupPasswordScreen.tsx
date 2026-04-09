import React from "react";

type SetupPasswordScreenProps = {
  password: string;
  confirmPassword: string;
  error: string;
  onPasswordChange: (value: string) => void;
  onConfirmChange: (value: string) => void;
  onSubmit: () => void;
};

export default function SetupPasswordScreen(props: SetupPasswordScreenProps) {
  const { password, confirmPassword, error, onPasswordChange, onConfirmChange, onSubmit } = props;
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-title">
          <span className="auth-kicker">首次启用</span>
          <h2>设置登录密码</h2>
        </div>
        <div className="hint">首次启动需要设置安全登录密码，至少 8 位并包含字母与数字。</div>
        <form
          className="auth-form"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          <input
            type="password"
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
            placeholder="登录密码"
            autoFocus
          />
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => onConfirmChange(e.target.value)}
            placeholder="确认登录密码"
          />
          {error && <div className="inline-error">{error}</div>}
          <button className="primary-button" type="submit">
            保存并进入
          </button>
        </form>
        <div className="auth-meta">提示：请妥善保管登录密码，忘记后将无法解锁。</div>
      </div>
    </div>
  );
}

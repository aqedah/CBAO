import { Component, type ReactNode } from 'react';

interface State { error: Error | null }

/** 한 화면의 오류가 앱 전체(메뉴 포함)를 지우지 않게 한다. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidUpdate(prev: { resetKey: string }) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }); }
  render() {
    if (this.state.error) {
      return (
        <div className="notice error" role="alert">
          <strong>이 화면에서 오류가 났습니다.</strong> 다른 메뉴는 계속 쓸 수 있습니다.
          <div className="meta" style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{this.state.error.message}</div>
          <button type="button" className="btn small" style={{ marginTop: 8 }} onClick={() => this.setState({ error: null })}>다시 시도</button>
        </div>
      );
    }
    return this.props.children;
  }
}

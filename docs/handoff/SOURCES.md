# 공식 기술 근거

확인일: 2026-10-28. 다음은 공개 기술 문서이며 사용자 계정이나 저장소의 연결 확인 자료가 아니다. 디자인·배치·개발 우선순위는 본 패키지의 설계 결정이다. 설치된 패키지의 정확한 버전은 개발 시작 시 확인하고 고정한다.

| ID | 문서 | 사용 범위 |
|---|---|---|
| S01 | PixiJS v8 Application — https://pixijs.com/8.x/guides/components/application | 비동기 init, renderer lifecycle |
| S02 | PixiJS v8 Textures — https://pixijs.com/8.x/guides/components/textures | TextureSource/Texture, 스프라이트와 샘플링 |
| S03 | PixiJS v8 Events — https://pixijs.com/8.x/guides/components/events | eventMode, 포인터 상호작용 |
| S04 | MDN image-rendering — https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/image-rendering | 이미지 확대/축소 알고리즘 |
| S05 | MDN prefers-reduced-motion — https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion | 사용자의 움직임 축소 설정 |
| S06 | React useEffect — https://react.dev/reference/react/useEffect | 외부 시스템 동기화와 cleanup |
| S07 | PixiJS SCALE_MODE — https://pixijs.download/release/docs/rendering.SCALE_MODE.html | nearest / linear 샘플링 값 |
| S08 | React Three Fiber introduction — https://r3f.docs.pmnd.rs/ | 실제 3D 구현을 후속 선택할 때의 별도 경로. 이번 기본 의존성은 아님 |

오픈소스 라이브러리의 현재 세부 API와 설치 환경의 호환성을 이 문서만으로 확정하지 않는다. API 예제는 해당 버전의 공식 문서와 실제 build/test로 검증한다.

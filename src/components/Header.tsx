import styled from "styled-components";

const HeaderStyle = styled.header`
    flex-shrink: 0;

    h1 {
        white-space: nowrap;
    }
`;

export default function Header() {
    return(
        <HeaderStyle>
            <h1>LITTLE FINGERS</h1>
        </HeaderStyle>
    )
}

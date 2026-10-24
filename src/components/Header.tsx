import styled from "styled-components";

const HeaderWrapper = styled.div`
    position: relative;
`;

const HeaderStyle = styled.header`
    position: absolute;
    z-index: 10;
`;

export default function Header() {
    return(
        <HeaderWrapper>
            <HeaderStyle>
                <h1>LITTLE FINGERS</h1>
            </HeaderStyle>
        </HeaderWrapper>
    )
}

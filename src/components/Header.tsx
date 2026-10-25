import styled from "styled-components";

const H1Style = styled.h1`
    color: #2a7099;
    white-space: nowrap;
    padding-left: 6%;
`;


export default function Header() {
    return(
        <header>
            <H1Style>Move & Make</H1Style>
        </header>
    )
}

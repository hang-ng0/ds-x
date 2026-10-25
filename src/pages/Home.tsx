// home page
import home_bg from "../images/Home Screen.png";
import styled from "styled-components";

const StyledDiv = styled.div`
    width: 100%;
    min-height: 100dvh;
    background-image: url(${home_bg});
    background-position: center;
    background-size: cover;
    background-repeat: no-repeat;
`;

export default function Home(){
    return(
        <>
            <StyledDiv></StyledDiv>
        </>
    )
}
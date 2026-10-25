// home page
import home_bg from "../images/Home Screen.png";
import styled from "styled-components";
import HomeHeader from "../components/HomeHeader.tsx";


const StyledDiv = styled.div`
    width: 100%;
    overflow-x: clip;
    height: 100vh;
    background-image: url(${home_bg});
    background-position: center;
    background-size: cover;
    background-repeat: no-repeat;

`;

export default function Home(){
    return(
        <>
            <StyledDiv>
                <HomeHeader/>
            </StyledDiv>
        </>
    )
}
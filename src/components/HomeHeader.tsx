// Styling for just the title text on the homescreen
import styled from "styled-components";

const StyledHeader = styled.header`
    position: relative;
`;

const StyledH1 = styled.h1`
    color: #2a7099;
    position: absolute;
    font-size: calc(2px + 10vw);
    text-shadow: 2px 5px #0c334a, -1px -3px #a3d3f1;
    padding: 2% 3%;
    animation: swingBackAndForth 2s ease-in-out infinite alternate;

    //adds the swinging animation 
    @keyframes swingBackAndForth {
        0% {
            transform: rotate(-5deg);
        }
        100% {
            transform: rotate(5deg);
        }
    }
`;

export default function HomeHeader() {
    return(
        <StyledHeader>
            <StyledH1>Move & Make</StyledH1>
        </StyledHeader>
    )
}